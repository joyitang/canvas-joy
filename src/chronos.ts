/**
 * chronos.ts — minimalist timeline slicing ("Chronos") for Obsidian Canvas.
 *
 * Two-state design:
 *  - OFF (default): zero DOM mutations, zero visual noise. Supports Cmd/Ctrl+Click
 *    on any date in a card or context menu to jump straight into Chronos.
 *  - ON (toolbar hourglass toggle): shows a minimalist horizontal dual-slider
 *    bar at the bottom, underlines detected dates in card previews with a subtle
 *    dashed line (click once to focus, click again to reset), and dims (or hides)
 *    out-of-range cards while preserving free whiteboard layout & multi-region sections.
 */

import { App, Modal, Plugin, setIcon } from "obsidian";
import {
  CanvasLike,
  NodeLike,
  allEdges,
  allNodes,
  commit,
  isEditing,
  nodeFromEvent,
  setNodeData,
} from "./bridge";
import { isGroupNode, nodeTextContent, nodesInsideGroup } from "./model";
import {
  TIME_OVERRIDE,
  TimeRange,
  formatYear,
  parseDatesFromText,
  parseManualTime,
  rangesIntersect,
} from "./chronos-parser";

interface FocusedEvent {
  nodeId: string;
  start: number;
  end: number;
  raw: string;
}

interface ChronosState {
  active: boolean;
  minYear: number;
  maxYear: number;
  selStart: number;
  selEnd: number;
  hasDates: boolean;
  window30: boolean;
  focusedEvent: FocusedEvent | null;
  nodeRanges: Map<string, TimeRange[]>;
  barEl: HTMLElement | null;
  dragging: null | {
    kind: "start" | "end" | "band";
    pointerStartX: number;
    origStart: number;
    origEnd: number;
    trackWidth: number;
  };
}

const SKIP_TAGS = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA", "INPUT", "BUTTON"]);

export function manualTimeOf(node: NodeLike): string {
  const val = node.getData()[TIME_OVERRIDE];
  return typeof val === "string" ? val : "";
}

export function nodeTimeRanges(node: NodeLike): TimeRange[] {
  const manual = manualTimeOf(node).trim();
  if (manual) return parseManualTime(manual);
  return parseDatesFromText(nodeTextContent(node));
}

export class ChronosController {
  private states = new Map<CanvasLike, ChronosState>();
  private onActiveChange?: (canvas: CanvasLike, active: boolean) => void;

  constructor(
    private plugin: Plugin,
    opts?: { onActiveChange?: (canvas: CanvasLike, active: boolean) => void }
  ) {
    this.onActiveChange = opts?.onActiveChange;

    this.plugin.registerDomEvent(
      window,
      "click",
      (evt: MouseEvent) => this.onWindowClick(evt),
      true
    );
    this.plugin.registerDomEvent(
      window,
      "dblclick",
      (evt: MouseEvent) => this.onWindowDblClick(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointermove",
      (evt: PointerEvent) => this.onPointerMove(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointerup",
      () => this.onPointerUp(),
      true
    );
  }

  isActive(canvas: CanvasLike): boolean {
    return this.states.get(canvas)?.active === true;
  }

  toggle(canvas: CanvasLike): boolean {
    if (this.isActive(canvas)) {
      this.close(canvas);
      return false;
    }
    this.open(canvas);
    return true;
  }

  open(canvas: CanvasLike): void {
    const state = this.ensureState(canvas);
    state.active = true;
    this.recompute(canvas, state, true);
    this.ensureBar(canvas, state);
    this.applyAll(canvas, state);
    this.onActiveChange?.(canvas, true);
  }

  close(canvas: CanvasLike): void {
    const state = this.states.get(canvas);
    if (!state || !state.active) return;
    state.active = false;
    state.focusedEvent = null;
    state.dragging = null;
    state.barEl?.remove();
    state.barEl = null;
    this.clearVisuals(canvas);
    this.onActiveChange?.(canvas, false);
  }

  /** Focus Chronos onto a specific event range (opens Chronos if closed). */
  focusEvent(
    canvas: CanvasLike,
    nodeId: string,
    start: number,
    end: number,
    raw: string
  ): void {
    const wasActive = this.isActive(canvas);
    const state = this.ensureState(canvas);
    state.active = true;
    this.recompute(canvas, state, !wasActive);
    this.ensureBar(canvas, state);

    // Toggle off focus if clicking the exact same already-focused event
    if (
      state.focusedEvent &&
      state.focusedEvent.nodeId === nodeId &&
      state.focusedEvent.start === start &&
      state.focusedEvent.end === end &&
      state.focusedEvent.raw === raw
    ) {
      this.resetRange(canvas, state);
      return;
    }

    state.focusedEvent = { nodeId, start, end, raw };
    this.applyFocusedWindow(state);
    this.applyAll(canvas, state);
    if (!wasActive) this.onActiveChange?.(canvas, true);
  }

  /** Focus Chronos onto a whole node's detected/manual time range (from context menu). */
  focusNode(canvas: CanvasLike, node: NodeLike): void {
    const ranges = nodeTimeRanges(node);
    if (!ranges.length) {
      this.open(canvas);
      return;
    }
    const start = Math.min(...ranges.map((r) => r.start));
    const end = Math.max(...ranges.map((r) => r.end));
    this.focusEvent(canvas, node.id, start, end, ranges[0].raw);
  }

  /** Open modal to manually specify or clear `jceTime` on a node. */
  openSetTimeModal(canvas: CanvasLike, node: NodeLike): void {
    new SetTimeModal(this.plugin.app, node, (value) => {
      const next = { ...node.getData() };
      if (value) next[TIME_OVERRIDE] = value;
      else delete next[TIME_OVERRIDE];
      setNodeData(canvas, node, next);
      commit(canvas);
      this.sync(canvas);
    }).open();
  }

  /** Called on canvas frame/DOM updates to keep dates, underlines, and filter fresh. */
  sync(canvas: CanvasLike): void {
    const state = this.states.get(canvas);
    if (!state || !state.active) return;
    this.recompute(canvas, state, false);
    this.ensureBar(canvas, state);
    this.applyAll(canvas, state);
  }

  detach(canvas: CanvasLike): void {
    this.close(canvas);
    this.states.delete(canvas);
  }

  destroy(): void {
    for (const canvas of Array.from(this.states.keys())) {
      this.close(canvas);
    }
    this.states.clear();
  }

  // ----------------------------------------------------------- state & model

  private ensureState(canvas: CanvasLike): ChronosState {
    let state = this.states.get(canvas);
    if (!state) {
      state = {
        active: false,
        minYear: 0,
        maxYear: 1000,
        selStart: 0,
        selEnd: 1000,
        hasDates: false,
        window30: true,
        focusedEvent: null,
        nodeRanges: new Map(),
        barEl: null,
        dragging: null,
      };
      this.states.set(canvas, state);
    }
    return state;
  }

  private recompute(canvas: CanvasLike, state: ChronosState, resetSelection: boolean): void {
    const prevMin = state.minYear;
    const prevMax = state.maxYear;
    const wasFull = state.selStart <= prevMin && state.selEnd >= prevMax;

    const map = new Map<string, TimeRange[]>();
    let minY = Infinity;
    let maxY = -Infinity;

    for (const node of allNodes(canvas)) {
      if (isGroupNode(node)) continue;
      const ranges = nodeTimeRanges(node);
      if (ranges.length > 0) {
        map.set(node.id, ranges);
        for (const r of ranges) {
          if (r.start < minY) minY = r.start;
          if (r.end > maxY) maxY = r.end;
        }
      }
    }

    state.nodeRanges = map;
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      state.hasDates = false;
      state.minYear = 0;
      state.maxYear = 1000;
      state.selStart = 0;
      state.selEnd = 1000;
      return;
    }

    // Add a tiny symmetric padding when all events fall on a single year
    if (minY === maxY) {
      minY -= 30;
      maxY += 30;
    }

    state.hasDates = true;
    state.minYear = minY;
    state.maxYear = maxY;

    if (resetSelection || wasFull) {
      state.selStart = minY;
      state.selEnd = maxY;
      state.focusedEvent = null;
    } else if (state.focusedEvent) {
      this.applyFocusedWindow(state);
    } else {
      state.selStart = clamp(state.selStart, minY, maxY);
      state.selEnd = clamp(state.selEnd, state.selStart, maxY);
    }
  }

  private applyFocusedWindow(state: ChronosState): void {
    const ev = state.focusedEvent;
    if (!ev || !state.hasDates) return;
    const pad = state.window30 ? 30 : 0;
    state.selStart = clamp(ev.start - pad, state.minYear, state.maxYear);
    state.selEnd = clamp(ev.end + pad, state.selStart, state.maxYear);
  }

  private resetRange(canvas: CanvasLike, state: ChronosState): void {
    state.focusedEvent = null;
    state.selStart = state.minYear;
    state.selEnd = state.maxYear;
    this.applyAll(canvas, state);
  }

  // ----------------------------------------------------------- visual apply

  private applyAll(canvas: CanvasLike, state: ChronosState): void {
    canvas.wrapperEl.classList.add("jce-chronos-mode");

    const isFullRange = !state.hasDates || (state.selStart <= state.minYear && state.selEnd >= state.maxYear);
    const matchedIds = new Set<string>();
    let datedTotal = 0;
    let datedMatched = 0;

    // 1. Evaluate non-group cards (always dim out-of-range, always keep undated cards)
    for (const node of allNodes(canvas)) {
      if (isGroupNode(node)) continue;
      const ranges = state.nodeRanges.get(node.id);
      const hasDate = !!ranges && ranges.length > 0;
      if (hasDate) datedTotal++;

      let matched: boolean;
      if (isFullRange) {
        matched = true;
        if (hasDate) datedMatched++;
      } else if (hasDate) {
        matched = rangesIntersect(ranges!, state.selStart, state.selEnd);
        if (matched) datedMatched++;
      } else {
        matched = true;
      }

      if (matched) matchedIds.add(node.id);

      // Underline dates in preview DOM (unwrap if editing) & apply intra-card block dimming
      this.decorateNodeDates(node, state);
      this.applyBlockFiltering(node, state, isFullRange, matched);
    }

    // 2. Keep a Section visible if full range OR at least one inner card is matched
    for (const node of allNodes(canvas)) {
      if (!isGroupNode(node)) continue;
      if (isFullRange) {
        matchedIds.add(node.id);
      } else {
        const kids = nodesInsideGroup(canvas, node);
        if (kids.some((k) => matchedIds.has(k.id))) {
          matchedIds.add(node.id);
        }
      }
    }

    // 3. Toggle classes on nodes and edges
    for (const node of allNodes(canvas)) {
      const el = node.nodeEl;
      if (!el) continue;
      const hit = matchedIds.has(node.id);
      el.classList.toggle("jce-chronos-match", hit);
      el.classList.toggle("jce-chronos-dim", !hit);
    }

    for (const edge of allEdges(canvas)) {
      const keep = matchedIds.has(edge.from.node.id) && matchedIds.has(edge.to.node.id);
      edge.lineGroupEl?.classList.toggle("jce-chronos-edge-dim", !keep);
      edge.lineEndGroupEl?.classList.toggle("jce-chronos-edge-dim", !keep);
    }

    this.renderBar(canvas, state, datedMatched, datedTotal, isFullRange);
  }

  private clearVisuals(canvas: CanvasLike): void {
    canvas.wrapperEl.classList.remove("jce-chronos-mode", "jce-chronos-only");
    for (const node of allNodes(canvas)) {
      node.nodeEl?.classList.remove("jce-chronos-match", "jce-chronos-dim");
      if (node.nodeEl) {
        clearBlockClasses(node.nodeEl);
        unwrapDates(node.nodeEl);
      }
    }
    for (const edge of allEdges(canvas)) {
      edge.lineGroupEl?.classList.remove("jce-chronos-edge-dim");
      edge.lineEndGroupEl?.classList.remove("jce-chronos-edge-dim");
    }
  }

  // --------------------------------------------------- preview date underline

  private decorateNodeDates(node: NodeLike, state: ChronosState): void {
    const el = node.nodeEl;
    if (!el) return;
    if (isEditing(node)) {
      unwrapDates(el);
      return;
    }

    const content =
      (el.querySelector(".markdown-preview-view") as HTMLElement | null) ??
      (el.querySelector(".canvas-node-content") as HTMLElement | null);
    if (!content) return;

    // Update active highlight on existing spans if already decorated for current text
    const existingSpans = content.querySelectorAll<HTMLElement>(".jce-chronos-date");
    const sig = nodeTextContent(node);
    if (content.dataset.jceChronosSig === sig && existingSpans.length > 0) {
      this.updateActiveDateSpans(existingSpans, node.id, state.focusedEvent);
      return;
    }

    unwrapDates(content);
    content.dataset.jceChronosSig = sig;

    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode(textNode) {
        const parent = textNode.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (
          parent.closest(
            ".jce-chronos-date, .jce-collapsed-bar, .jce-lod-overlay, .cm-editor, a"
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!textNode.nodeValue || textNode.nodeValue.trim().length < 2) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }

    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      const matches = parseDatesFromText(value);
      if (!matches.length) continue;

      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const m of matches) {
        if (m.index > cursor) {
          frag.appendChild(document.createTextNode(value.slice(cursor, m.index)));
        }
        const span = document.createElement("span");
        span.className = "jce-chronos-date";
        span.dataset.nodeId = node.id;
        span.dataset.start = String(m.start);
        span.dataset.end = String(m.end);
        span.dataset.raw = m.raw;
        span.textContent = m.raw;
        if (
          state.focusedEvent &&
          state.focusedEvent.nodeId === node.id &&
          state.focusedEvent.start === m.start &&
          state.focusedEvent.end === m.end &&
          state.focusedEvent.raw === m.raw
        ) {
          span.classList.add("is-active");
        }
        frag.appendChild(span);
        cursor = m.index + m.length;
      }
      if (cursor < value.length) {
        frag.appendChild(document.createTextNode(value.slice(cursor)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  private updateActiveDateSpans(
    spans: NodeListOf<HTMLElement>,
    nodeId: string,
    focused: FocusedEvent | null
  ): void {
    spans.forEach((span) => {
      const active =
        !!focused &&
        focused.nodeId === nodeId &&
        Number(span.dataset.start) === focused.start &&
        Number(span.dataset.end) === focused.end &&
        span.dataset.raw === focused.raw;
      span.classList.toggle("is-active", active);
    });
  }

  /**
   * Intra-card block filtering for multi-period cards:
   * Only kicks in when a matched card spans MULTIPLE periods (contains at least
   * one date inside `[selStart, selEnd]` AND at least one date outside it).
   * Single-period cards (e.g. a card whose title is "5-7世纪" with explanatory
   * bullets below) stay 100% clear so their body text is never mistakenly dimmed.
   */
  private applyBlockFiltering(
    node: NodeLike,
    state: ChronosState,
    isFullRange: boolean,
    cardMatched: boolean
  ): void {
    const el = node.nodeEl;
    if (!el) return;
    clearBlockClasses(el);

    if (isFullRange || !cardMatched || isEditing(node)) return;

    const content =
      (el.querySelector(".markdown-preview-view") as HTMLElement | null) ??
      (el.querySelector(".canvas-node-content") as HTMLElement | null);
    if (!content) return;

    const allSpans = Array.from(content.querySelectorAll<HTMLElement>(".jce-chronos-date"));
    if (allSpans.length < 2) return;

    let hasInRange = false;
    let hasOutRange = false;
    const spanHit = new Map<HTMLElement, boolean>();

    for (const span of allSpans) {
      const s = Number(span.dataset.start);
      const e = Number(span.dataset.end);
      const hit = Number.isFinite(s) && Number.isFinite(e) && rangesIntersect([{ start: s, end: e }], state.selStart, state.selEnd);
      spanHit.set(span, hit);
      if (hit) hasInRange = true;
      else hasOutRange = true;
    }

    // Single-period card: keep entire card crystal clear
    if (!hasInRange || !hasOutRange) return;

    // Collect every logical block inside preview: list items (`li`) and non-list paragraphs (`p`)
    const listItems = Array.from(content.querySelectorAll<HTMLElement>("li"));
    const topParagraphs = Array.from(content.querySelectorAll<HTMLElement>("p")).filter(
      (p) => !p.closest("li")
    );
    const blocks: HTMLElement[] = [...listItems, ...topParagraphs];
    if (blocks.length < 2) return;

    // For each block, inspect ONLY its own direct date spans (excluding nested `li` children)
    const ownStatus = new Map<HTMLElement, "hit" | "miss" | "none">();
    for (const block of blocks) {
      const ownSpans = Array.from(block.querySelectorAll<HTMLElement>(".jce-chronos-date")).filter(
        (sp) => sp.closest("li, p") === block
      );
      if (!ownSpans.length) {
        ownStatus.set(block, "none");
      } else if (ownSpans.some((sp) => spanHit.get(sp) === true)) {
        ownStatus.set(block, "hit");
      } else {
        ownStatus.set(block, "miss");
      }
    }

    // Keep blocks that are:
    //  1) directly hit (`ownStatus === "hit"`),
    //  2) an ancestor `li` of a hit block (preserves outline parent like "基督教会"),
    //  3) a descendant `li` of a hit block that does NOT itself carry an out-of-range date
    //     (preserves explanatory sub-bullets under a matched dated item like "1054年 -> 罗马教皇...").
    const keep = new Set<HTMLElement>();
    for (const block of blocks) {
      if (ownStatus.get(block) !== "hit") continue;
      keep.add(block);
      block.classList.add("jce-chronos-block-hit");

      // Walk up ancestor <li>s to preserve outline context
      let parentLi = block.parentElement?.closest("li") as HTMLElement | null;
      while (parentLi && content.contains(parentLi)) {
        keep.add(parentLi);
        parentLi = parentLi.parentElement?.closest("li") as HTMLElement | null;
      }

      // Walk down descendant <li>s that don't explicitly belong to another period
      if (block.tagName === "LI") {
        const subLis = Array.from(block.querySelectorAll<HTMLElement>("li"));
        for (const sub of subLis) {
          if (ownStatus.get(sub) !== "miss") {
            keep.add(sub);
          }
        }
      }
    }

    // Dim every non-kept block whose parent is NOT already dimmed (avoids double-compounding opacity)
    for (const block of blocks) {
      if (keep.has(block)) continue;
      const parentLi = block.parentElement?.closest("li") as HTMLElement | null;
      if (parentLi && !keep.has(parentLi) && content.contains(parentLi)) {
        continue;
      }
      block.classList.add("jce-chronos-block-dim");
    }
  }

  // ------------------------------------------------ click & Cmd+click wiring

  private onWindowClick(evt: MouseEvent): void {
    if (evt.button !== 0) return;
    const target = evt.target as Element | null;
    if (!target) return;

    // 1. Chronos ON: single-click on an underlined `.jce-chronos-date` focuses/resets timeline
    //    (pierces `.canvas-node-content-blocker` so an unselected card works on the very first click).
    const wrapper = target.closest?.(".canvas-wrapper") as HTMLElement | null;
    const canvas = wrapper ? this.canvasForElement(wrapper) : null;

    if (canvas && this.isActive(canvas) && evt.detail === 1) {
      const dateSpan = findDateSpanAtEvent(canvas, target, evt.clientX, evt.clientY);
      if (dateSpan) {
        const nodeId = dateSpan.dataset.nodeId ?? "";
        const start = Number(dateSpan.dataset.start);
        const end = Number(dateSpan.dataset.end);
        const raw = dateSpan.dataset.raw ?? dateSpan.textContent ?? "";
        if (nodeId && Number.isFinite(start) && Number.isFinite(end)) {
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation?.();
          this.focusEvent(canvas, nodeId, start, end, raw);
        }
        return;
      }
    }

    // 2. Chronos OFF: Cmd/Ctrl + Click on a date inside any preview card launches Chronos focused on it
    if (canvas && !this.isActive(canvas) && (evt.metaKey || evt.ctrlKey)) {
      const node = nodeFromEvent(canvas, target);
      if (!node || isEditing(node) || isGroupNode(node)) return;

      const hit = dateAtPointPiercingBlocker(node, evt.clientX, evt.clientY);
      if (!hit) return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation?.();
      this.focusEvent(canvas, node.id, hit.start, hit.end, hit.raw);
    }
  }

  private onWindowDblClick(evt: MouseEvent): void {
    const target = evt.target as Element | null;
    const dateSpan = target?.closest?.(".jce-chronos-date") as HTMLElement | null;
    if (!dateSpan) return;
    const canvas = this.canvasForElement(dateSpan);
    if (!canvas) return;
    const node = nodeFromEvent(canvas, dateSpan);
    if (node && !isEditing(node)) {
      // Unwrap dates cleanly so native double-click edit starts with pure text
      unwrapDates(node.nodeEl);
      node.startEditing?.();
    }
  }

  private canvasForElement(el: Element): CanvasLike | null {
    const wrapper = el.closest(".canvas-wrapper");
    if (!wrapper) return null;
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
      const c = (leaf.view as { canvas?: CanvasLike }).canvas;
      if (c?.wrapperEl === wrapper) return c;
    }
    return null;
  }

  // ------------------------------------------------ minimalist bottom bar UI

  private ensureBar(canvas: CanvasLike, state: ChronosState): HTMLElement {
    if (state.barEl && state.barEl.isConnected) return state.barEl;
    const host =
      (canvas.wrapperEl.closest(".view-content") as HTMLElement | null) ??
      canvas.wrapperEl;

    const bar = host.createDiv({ cls: "jce-chronos-bar" });
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());

    // Left: range readout + count badge
    const info = bar.createDiv({ cls: "jce-chronos-info" });
    info.createSpan({ cls: "jce-chronos-range" });
    info.createSpan({ cls: "jce-chronos-count" });

    // Center: minimalist horizontal line track with dual thumbs & ticks
    const trackWrap = bar.createDiv({ cls: "jce-chronos-track-wrap" });
    const track = trackWrap.createDiv({ cls: "jce-chronos-track" });
    track.createDiv({ cls: "jce-chronos-rail" });
    const band = track.createDiv({ cls: "jce-chronos-band" });
    const thumbStart = track.createDiv({
      cls: "jce-chronos-thumb",
      attr: { "data-thumb": "start", title: "起始年份 / Start year" },
    });
    const thumbEnd = track.createDiv({
      cls: "jce-chronos-thumb",
      attr: { "data-thumb": "end", title: "结束年份 / End year" },
    });
    trackWrap.createDiv({ cls: "jce-chronos-ticks" });

    const startDrag = (kind: "start" | "end" | "band", evt: PointerEvent) => {
      if (evt.button !== 0 || !state.hasDates) return;
      evt.preventDefault();
      evt.stopPropagation();
      const rect = track.getBoundingClientRect();
      state.dragging = {
        kind,
        pointerStartX: evt.clientX,
        origStart: state.selStart,
        origEnd: state.selEnd,
        trackWidth: Math.max(1, rect.width),
      };
      bar.classList.add("is-dragging");
    };

    thumbStart.addEventListener("pointerdown", (e) => startDrag("start", e));
    thumbEnd.addEventListener("pointerdown", (e) => startDrag("end", e));
    band.addEventListener("pointerdown", (e) => startDrag("band", e));

    // Clicking on the rail jumps the nearest thumb
    track.addEventListener("pointerdown", (e) => {
      if (e.target === thumbStart || e.target === thumbEnd || e.target === band) return;
      if (e.button !== 0 || !state.hasDates) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = track.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const year = Math.round(state.minYear + ratio * (state.maxYear - state.minYear));
      state.focusedEvent = null;
      if (Math.abs(year - state.selStart) <= Math.abs(year - state.selEnd)) {
        state.selStart = Math.min(year, state.selEnd);
      } else {
        state.selEnd = Math.max(year, state.selStart);
      }
      this.applyAll(canvas, state);
    });

    // Right: minimal controls (only ±30年 toggle, contextual Reset action, Close)
    const controls = bar.createDiv({ cls: "jce-chronos-controls" });

    const winBtn = controls.createEl("button", {
      type: "button",
      cls: "jce-chronos-chip",
      text: "±30年",
      attr: { "data-act": "win30", title: "点击正文日期时，前后扩展 ±30 年查看同期事件" },
    });
    winBtn.addEventListener("mousedown", (e) => e.preventDefault());
    winBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.window30 = !state.window30;
      if (state.focusedEvent) this.applyFocusedWindow(state);
      this.applyAll(canvas, state);
    });

    const resetBtn = controls.createEl("button", {
      type: "button",
      cls: "jce-chronos-action",
      attr: { "data-act": "reset", title: "重置为全部年份 / Reset to full range" },
    });
    const resetIcon = resetBtn.createSpan({ cls: "jce-chronos-action-icon" });
    setIcon(resetIcon, "rotate-ccw");
    resetBtn.createSpan({ text: "重置" });
    resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.resetRange(canvas, state);
    });

    const closeBtn = controls.createEl("button", {
      type: "button",
      cls: "jce-chronos-close",
      attr: { "aria-label": "关闭时间轴", title: "关闭时间轴 / Close Chronos" },
    });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close(canvas);
    });

    state.barEl = bar;
    return bar;
  }

  private renderBar(
    _canvas: CanvasLike,
    state: ChronosState,
    matched: number,
    total: number,
    isFullRange: boolean
  ): void {
    const bar = state.barEl;
    if (!bar) return;

    const rangeEl = bar.querySelector<HTMLElement>(".jce-chronos-range");
    const countEl = bar.querySelector<HTMLElement>(".jce-chronos-count");
    const trackWrap = bar.querySelector<HTMLElement>(".jce-chronos-track-wrap");
    const band = bar.querySelector<HTMLElement>(".jce-chronos-band");
    const thumbStart = bar.querySelector<HTMLElement>('.jce-chronos-thumb[data-thumb="start"]');
    const thumbEnd = bar.querySelector<HTMLElement>('.jce-chronos-thumb[data-thumb="end"]');
    const ticksEl = bar.querySelector<HTMLElement>(".jce-chronos-ticks");

    if (!state.hasDates) {
      if (rangeEl) rangeEl.textContent = "未检测到年份";
      if (countEl) countEl.textContent = "右键卡片可指定";
      trackWrap?.classList.add("is-empty");
    } else {
      trackWrap?.classList.remove("is-empty");
      if (rangeEl) {
        rangeEl.textContent =
          state.selStart === state.selEnd
            ? formatYear(state.selStart, true)
            : `${formatYear(state.selStart)} — ${formatYear(state.selEnd)}`;
      }
      if (countEl) countEl.textContent = `${matched}/${total}`;

      const span = Math.max(1, state.maxYear - state.minYear);
      const p1 = clamp(((state.selStart - state.minYear) / span) * 100, 0, 100);
      const p2 = clamp(((state.selEnd - state.minYear) / span) * 100, p1, 100);

      if (band) {
        band.style.left = `${p1}%`;
        band.style.width = `${Math.max(0.5, p2 - p1)}%`;
      }
      if (thumbStart) thumbStart.style.left = `${p1}%`;
      if (thumbEnd) thumbEnd.style.left = `${p2}%`;

      if (ticksEl) {
        const sig = `${state.minYear}:${state.maxYear}`;
        if (ticksEl.dataset.sig !== sig) {
          ticksEl.dataset.sig = sig;
          ticksEl.empty();
          const steps = 4;
          for (let i = 0; i <= steps; i++) {
            const y = Math.round(state.minYear + ((state.maxYear - state.minYear) * i) / steps);
            ticksEl.createSpan({ cls: "jce-chronos-tick", text: formatYear(y) });
          }
        }
      }
    }

    const winBtn = bar.querySelector<HTMLElement>('[data-act="win30"]');
    winBtn?.classList.toggle("is-on", state.window30);

    const resetBtn = bar.querySelector<HTMLButtonElement>('[data-act="reset"]');
    if (resetBtn) {
      resetBtn.hidden = isFullRange;
    }
  }

  private onPointerMove(evt: PointerEvent): void {
    for (const [canvas, state] of this.states) {
      if (!state.dragging || !state.hasDates) continue;
      const { kind, pointerStartX, origStart, origEnd, trackWidth } = state.dragging;
      const dx = evt.clientX - pointerStartX;
      const span = state.maxYear - state.minYear;
      const deltaYears = Math.round((dx / trackWidth) * span);

      state.focusedEvent = null;
      if (kind === "start") {
        state.selStart = clamp(origStart + deltaYears, state.minYear, state.selEnd);
      } else if (kind === "end") {
        state.selEnd = clamp(origEnd + deltaYears, state.selStart, state.maxYear);
      } else {
        const width = origEnd - origStart;
        const nextStart = clamp(origStart + deltaYears, state.minYear, state.maxYear - width);
        state.selStart = nextStart;
        state.selEnd = nextStart + width;
      }
      this.applyAll(canvas, state);
    }
  }

  private onPointerUp(): void {
    for (const state of this.states.values()) {
      if (!state.dragging) continue;
      state.dragging = null;
      state.barEl?.classList.remove("is-dragging");
    }
  }
}

// ------------------------------------------------ manual time override modal

class SetTimeModal extends Modal {
  private value: string;

  constructor(
    app: App,
    private node: NodeLike,
    private onSubmit: (value: string) => void
  ) {
    super(app);
    this.value = manualTimeOf(node);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jce-time-modal");

    contentEl.createEl("h3", { text: "指定卡片年份 / Set Card Time" });

    const autoRanges = parseDatesFromText(nodeTextContent(this.node));
    const autoText = autoRanges.length
      ? autoRanges
          .map((r) =>
            r.start === r.end
              ? formatYear(r.start, true)
              : `${formatYear(r.start)}—${formatYear(r.end, true)}`
          )
          .join("、")
      : "无";

    contentEl.createDiv({
      cls: "jce-time-hint",
      text: `自动识别：${autoText}（留空保存将恢复自动识别，不修改正文）`,
    });

    const input = contentEl.createEl("input", {
      type: "text",
      cls: "jce-time-input",
      attr: {
        placeholder: "例如：1054、532-537、公元前221-前207、532-537, 1054",
      },
    });
    input.value = this.value;

    const preview = contentEl.createDiv({ cls: "jce-time-preview" });
    const updatePreview = () => {
      const v = input.value.trim();
      if (!v) {
        preview.textContent = "将使用正文自动识别结果";
        preview.classList.remove("is-invalid");
        return;
      }
      const parsed = parseManualTime(v);
      if (!parsed.length) {
        preview.textContent = "未能解析为有效年份，请检查格式";
        preview.classList.add("is-invalid");
      } else {
        preview.textContent =
          "解析结果：" +
          parsed
            .map((r) =>
              r.start === r.end
                ? formatYear(r.start, true)
                : `${formatYear(r.start)} — ${formatYear(r.end, true)}`
            )
            .join(" · ");
        preview.classList.remove("is-invalid");
      }
    };
    updatePreview();
    input.addEventListener("input", updatePreview);

    const actions = contentEl.createDiv({ cls: "jce-time-actions" });
    const clearBtn = actions.createEl("button", { type: "button", text: "清除覆盖" });
    clearBtn.addEventListener("click", () => {
      this.onSubmit("");
      this.close();
    });

    const saveBtn = actions.createEl("button", {
      type: "button",
      cls: "mod-cta",
      text: "保存",
    });
    const commitModal = () => {
      this.onSubmit(input.value.trim());
      this.close();
    };
    saveBtn.addEventListener("click", commitModal);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitModal();
      }
    });

    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 20);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ------------------------------------------------------------------ helpers

function clearBlockClasses(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLElement>(".jce-chronos-block-dim, .jce-chronos-block-hit")
    .forEach((el) => {
      el.classList.remove("jce-chronos-block-dim", "jce-chronos-block-hit");
    });
}

function unwrapDates(root: HTMLElement): void {
  const spans = root.querySelectorAll<HTMLElement>(".jce-chronos-date");
  if (!spans.length) {
    if (root.dataset.jceChronosSig) delete root.dataset.jceChronosSig;
    return;
  }
  const parents = new Set<Node>();
  spans.forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    parents.add(parent);
    parent.replaceChild(document.createTextNode(span.textContent ?? ""), span);
  });
  parents.forEach((p) => p.normalize());
  root.querySelectorAll<HTMLElement>("[data-jce-chronos-sig]").forEach((el) => {
    delete el.dataset.jceChronosSig;
  });
  delete root.dataset.jceChronosSig;
}

function findDateSpanAtEvent(
  canvas: CanvasLike,
  target: Element,
  clientX: number,
  clientY: number
): HTMLElement | null {
  const direct = target.closest?.(".jce-chronos-date") as HTMLElement | null;
  if (direct) return direct;

  // Unselected cards sit behind `.canvas-node-content-blocker`; check hit-boxes directly.
  const node = nodeFromEvent(canvas, target);
  if (!node || isEditing(node) || isGroupNode(node)) return null;
  const spans = node.nodeEl.querySelectorAll<HTMLElement>(".jce-chronos-date");
  for (const span of Array.from(spans)) {
    const rects = span.getClientRects();
    for (const r of Array.from(rects)) {
      if (clientX >= r.left - 2 && clientX <= r.right + 2 && clientY >= r.top - 2 && clientY <= r.bottom + 2) {
        return span;
      }
    }
  }
  return null;
}

function dateAtPointPiercingBlocker(node: NodeLike, x: number, y: number): TimeRange | null {
  const blocker = node.nodeEl.querySelector<HTMLElement>(".canvas-node-content-blocker");
  const prev = blocker?.style.pointerEvents;
  if (blocker) blocker.style.pointerEvents = "none";
  try {
    return dateAtPoint(x, y);
  } finally {
    if (blocker) blocker.style.pointerEvents = prev ?? "";
  }
}

function dateAtPoint(x: number, y: number): TimeRange | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const text = range.startContainer.nodeValue ?? "";
  const offset = range.startOffset;
  const matches = parseDatesFromText(text);
  for (const m of matches) {
    if (offset >= m.index && offset <= m.index + m.length) {
      return m;
    }
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
