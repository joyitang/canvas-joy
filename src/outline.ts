/**
 * outline.ts — Always-in-sync Section Outline drawer for Obsidian Canvas.
 *
 * UX contract:
 *  - OFF by default: zero elements visible on canvas until toggled via toolbar or ⌘⇧O.
 *  - ON: opens directly in expanded state at top-left (16px, 14px) or user's dragged position.
 *  - Persistent DOM shell: toggling compact capsule ↔ expanded never destroys DOM, enabling
 *    silky CSS grid-row + opacity + border-radius + chevron rotation transitions with fixed width.
 *  - Purely derived from live Section (group) nodes: click-to-jump only, creation order default,
 *    natural Chinese/English name sort, and drag-to-reorder inside the list.
 */

import { setIcon } from "obsidian";
import {
  CanvasLike,
  NodeLike,
  focusNodeInViewport,
  selectedNodes,
} from "./bridge";
import {
  isCardFolded,
  isGroupNode,
  nodesInsideGroup,
} from "./model";
import {
  OutlinePrefs,
  SectionEntry,
  reorderIds,
  sortSections,
} from "./outline-sort";

interface OutlineUiState {
  drawerOpen: boolean;
  compact: boolean;
  activeSectionId: string | null;
  drawerEl: HTMLElement | null;
  countBadgeEl: HTMLElement | null;
  listEl: HTMLElement | null;
  lastListSig: string;
}

export interface OutlineControllerOpts {
  getFilePath: (canvas: CanvasLike) => string | null;
  getPrefs: (filePath: string) => OutlinePrefs;
  setPrefs: (filePath: string, prefs: OutlinePrefs) => void;
  onOpenChange?: (canvas: CanvasLike, open: boolean) => void;
}

export class SectionOutlineController {
  private states = new Map<CanvasLike, OutlineUiState>();
  private pulseTimers = new WeakMap<NodeLike, number>();
  private animTimers = new WeakMap<HTMLElement, number>();
  private draggingId: string | null = null;

  constructor(private opts: OutlineControllerOpts) {}

  isOpen(canvas: CanvasLike): boolean {
    return this.states.get(canvas)?.drawerOpen === true;
  }

  toggle(canvas: CanvasLike): boolean {
    const st = this.ensureState(canvas);
    st.drawerOpen = !st.drawerOpen;
    if (st.drawerOpen) st.compact = false;
    this.opts.onOpenChange?.(canvas, st.drawerOpen);
    this.render(canvas, true);
    return st.drawerOpen;
  }

  close(canvas: CanvasLike): void {
    const st = this.states.get(canvas);
    if (!st || !st.drawerOpen) return;
    st.drawerOpen = false;
    this.opts.onOpenChange?.(canvas, false);
    this.render(canvas, true);
  }

  sync(canvas: CanvasLike): void {
    this.render(canvas, false);
  }

  detach(canvas: CanvasLike): void {
    const st = this.states.get(canvas);
    if (!st) return;
    st.drawerEl?.remove();
    this.states.delete(canvas);
  }

  destroy(): void {
    for (const canvas of Array.from(this.states.keys())) {
      this.detach(canvas);
    }
  }

  // ---------------------------------------------------------------- internals

  private ensureState(canvas: CanvasLike): OutlineUiState {
    let st = this.states.get(canvas);
    if (!st) {
      st = {
        drawerOpen: false,
        compact: false,
        activeSectionId: null,
        drawerEl: null,
        countBadgeEl: null,
        listEl: null,
        lastListSig: "",
      };
      this.states.set(canvas, st);
    }
    return st;
  }

  private hostOf(canvas: CanvasLike): HTMLElement | null {
    return canvas.wrapperEl.closest(".view-content") ?? canvas.wrapperEl;
  }

  private collectSections(canvas: CanvasLike): {
    entries: SectionEntry[];
    parentOf: Map<string, string>;
  } {
    const groups: NodeLike[] = [];
    for (const node of canvas.nodes.values()) {
      if (isGroupNode(node)) groups.push(node);
    }

    // Track direct parent group for nested sections so the outline only lists top-level sections.
    const parentOf = new Map<string, string>();
    for (const g of groups) {
      for (const inside of nodesInsideGroup(canvas, g)) {
        if (isGroupNode(inside) && inside.id !== g.id) {
          parentOf.set(inside.id, g.id);
        }
      }
    }

    const entries: SectionEntry[] = [];
    let idx = 0;
    for (const node of groups) {
      if (parentOf.has(node.id)) continue;
      const rawLabel = String(node.getData().label ?? node.label ?? "").trim();
      const label = rawLabel || "Section";
      const folded = isCardFolded(node);
      const inside = nodesInsideGroup(canvas, node).filter((n) => !isGroupNode(n));
      entries.push({
        id: node.id,
        label,
        cardCount: inside.length,
        folded,
        creationIndex: idx++,
      });
    }
    return { entries, parentOf };
  }

  private rootGroupId(id: string, parentOf: Map<string, string>): string {
    let cur = id;
    const seen = new Set<string>();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
    }
    return cur;
  }

  private ensureShell(canvas: CanvasLike, host: HTMLElement, st: OutlineUiState): HTMLElement {
    if (st.drawerEl && host.contains(st.drawerEl)) return st.drawerEl;

    host.querySelectorAll(".jce-outline-drawer").forEach((el) => el.remove());
    st.drawerEl?.remove();

    const drawer = host.createDiv({ cls: "jce-outline-drawer" });
    drawer.addEventListener("mousedown", (evt) => evt.stopPropagation());
    drawer.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    drawer.addEventListener("wheel", (evt) => evt.stopPropagation(), { passive: true });

    // Persistent header (also drag handle)
    const head = drawer.createDiv({ cls: "jce-outline-head" });
    const headTop = head.createDiv({ cls: "jce-outline-head-top" });
    const titleWrap = headTop.createDiv({ cls: "jce-outline-title-wrap" });
    const listIcon = titleWrap.createSpan({ cls: "jce-outline-title-icon" });
    setIcon(listIcon, "list");
    titleWrap.createSpan({ cls: "jce-outline-title", text: "分区大纲" });
    st.countBadgeEl = titleWrap.createSpan({ cls: "jce-outline-count-badge", text: "0" });

    const headBtns = headTop.createDiv({ cls: "jce-outline-head-btns" });
    const compactBtn = headBtns.createEl("button", {
      type: "button",
      cls: "jce-outline-icon-btn jce-outline-compact-btn",
      attr: { "aria-label": "缩放为胶囊 / 展开" },
    });
    const chevSpan = compactBtn.createSpan({ cls: "jce-outline-chev" });
    setIcon(chevSpan, "chevron-up");
    compactBtn.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    compactBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      st.compact = !st.compact;
      this.animateCompact(drawer, st.compact);
    });

    const closeBtn = headBtns.createEl("button", {
      type: "button",
      cls: "jce-outline-icon-btn jce-outline-close-btn",
      attr: { "aria-label": "关闭大纲 (Esc)" },
    });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    closeBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.close(canvas);
    });

    this.attachHeaderDrag(canvas, host, drawer, head, st);

    // Collapsible animated body wrapper (CSS grid-template-rows: 1fr <-> 0fr)
    const bodyWrap = drawer.createDiv({ cls: "jce-outline-body-wrap" });
    const bodyInner = bodyWrap.createDiv({ cls: "jce-outline-body-inner" });
    st.listEl = bodyInner.createDiv({ cls: "jce-outline-list" });

    st.drawerEl = drawer;
    return drawer;
  }

  private animateCompact(drawer: HTMLElement, compact: boolean): void {
    const prev = this.animTimers.get(drawer);
    if (prev) window.clearTimeout(prev);
    drawer.classList.add("is-animating");
    drawer.classList.toggle("is-compact", compact);
    const t = window.setTimeout(() => {
      drawer.classList.remove("is-animating");
      this.animTimers.delete(drawer);
    }, 260);
    this.animTimers.set(drawer, t);
  }

  private render(canvas: CanvasLike, force: boolean): void {
    const host = this.hostOf(canvas);
    if (!host) return;
    const st = this.ensureState(canvas);

    // When closed and never opened yet, keep DOM 100% clean (nothing on canvas)
    if (!st.drawerOpen && !st.drawerEl) return;

    const drawer = this.ensureShell(canvas, host, st);
    const filePath = this.opts.getFilePath(canvas);
    const prefs: OutlinePrefs = filePath ? this.opts.getPrefs(filePath) : {};

    // Apply visibility & compact classes without rebuilding DOM (preserves smooth CSS animations)
    if (!st.drawerOpen) {
      drawer.classList.remove("is-open");
      return;
    }

    this.applyDrawerPos(host, drawer, prefs.pos);
    drawer.classList.toggle("is-compact", st.compact);
    if (!drawer.classList.contains("is-open")) {
      void drawer.offsetHeight;
      drawer.classList.add("is-open");
    }

    const { entries: rawEntries, parentOf } = this.collectSections(canvas);
    const entries = sortSections(rawEntries, "order", prefs.customOrder);

    const selGroup = selectedNodes(canvas).find((n) => isGroupNode(n));
    if (selGroup) st.activeSectionId = this.rootGroupId(selGroup.id, parentOf);
    else if (st.activeSectionId && !canvas.nodes.has(st.activeSectionId)) {
      st.activeSectionId = null;
    }

    const sig = [
      filePath ?? "",
      prefs.customOrder?.join(",") ?? "",
      st.activeSectionId ?? "",
      entries.map((e) => `${e.id}:${e.label}:${e.cardCount}:${e.folded ? 1 : 0}`).join("|"),
    ].join("#");

    if (!force && sig === st.lastListSig) return;
    st.lastListSig = sig;

    if (st.countBadgeEl) st.countBadgeEl.textContent = String(entries.length);
    if (st.listEl) this.renderList(canvas, st, st.listEl, filePath, entries);
  }

  private renderList(
    canvas: CanvasLike,
    st: OutlineUiState,
    list: HTMLElement,
    filePath: string | null,
    entries: SectionEntry[]
  ): void {
    list.empty();
    if (entries.length === 0) {
      list.createDiv({
        cls: "jce-outline-empty",
        text: "当前画布暂无分区，按 G 新建分区后会自动显示在这里。",
      });
      return;
    }

    const currentIds = entries.map((e) => e.id);

    for (const entry of entries) {
      const isActive = st.activeSectionId === entry.id;
      const row = list.createDiv({
        cls: `jce-outline-item${isActive ? " is-active" : ""}${entry.folded ? " is-folded" : ""}`,
        attr: {
          "data-section-id": entry.id,
          draggable: "true",
        },
      });

      const handle = row.createSpan({ cls: "jce-outline-drag-handle" });
      setIcon(handle, "grip-vertical");

      row.createSpan({ cls: "jce-outline-item-label", text: entry.label });

      const right = row.createDiv({ cls: "jce-outline-item-right" });
      if (entry.folded) {
        right.createSpan({ cls: "jce-outline-folded-tag", text: "已折叠" });
      }
      right.createSpan({
        cls: "jce-outline-item-count",
        text: String(entry.cardCount),
      });

      row.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.jumpToSection(canvas, st, entry.id);
      });

      row.addEventListener("dragstart", (evt) => {
        this.draggingId = entry.id;
        row.classList.add("is-dragging");
        if (evt.dataTransfer) {
          evt.dataTransfer.effectAllowed = "move";
          evt.dataTransfer.setData("text/plain", entry.id);
        }
      });

      row.addEventListener("dragend", () => {
        this.draggingId = null;
        row.classList.remove("is-dragging");
        list.querySelectorAll(".is-drop-before, .is-drop-after").forEach((el) => {
          el.classList.remove("is-drop-before", "is-drop-after");
        });
      });

      row.addEventListener("dragover", (evt) => {
        if (!this.draggingId || this.draggingId === entry.id) return;
        evt.preventDefault();
        const rect = row.getBoundingClientRect();
        const after = evt.clientY > rect.top + rect.height / 2;
        row.classList.toggle("is-drop-after", after);
        row.classList.toggle("is-drop-before", !after);
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("is-drop-before", "is-drop-after");
      });

      row.addEventListener("drop", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const dragId = this.draggingId || evt.dataTransfer?.getData("text/plain") || "";
        this.draggingId = null;
        if (!dragId || dragId === entry.id || !filePath) return;
        const rect = row.getBoundingClientRect();
        const after = evt.clientY > rect.top + rect.height / 2;
        const nextOrder = reorderIds(currentIds, dragId, entry.id, after);
        const curPrefs = this.opts.getPrefs(filePath);
        this.opts.setPrefs(filePath, {
          ...curPrefs,
          sortMode: "order",
          customOrder: nextOrder,
        });
        this.render(canvas, true);
      });
    }
  }

  private applyDrawerPos(
    host: HTMLElement,
    drawer: HTMLElement,
    pos?: { x: number; y: number }
  ): void {
    if (!pos) {
      drawer.setCssProps({ "--jce-outline-x": "66px", "--jce-outline-y": "14px" });
      return;
    }
    const maxX = Math.max(12, host.clientWidth - Math.min(260, host.clientWidth - 24) - 12);
    const maxY = Math.max(12, host.clientHeight - 52);
    const x = Math.round(Math.max(12, Math.min(pos.x, maxX)));
    const y = Math.round(Math.max(12, Math.min(pos.y, maxY)));
    drawer.setCssProps({ "--jce-outline-x": `${x}px`, "--jce-outline-y": `${y}px` });
  }

  private attachHeaderDrag(
    canvas: CanvasLike,
    host: HTMLElement,
    drawer: HTMLElement,
    head: HTMLElement,
    st: OutlineUiState
  ): void {
    head.addEventListener("pointerdown", (evt: PointerEvent) => {
      if (evt.button !== 0) return;
      if ((evt.target as Element | null)?.closest("button")) return;
      evt.preventDefault();
      evt.stopPropagation();

      const hostRect = host.getBoundingClientRect();
      const drawerRect = drawer.getBoundingClientRect();
      const startX = evt.clientX;
      const startY = evt.clientY;
      const origX = drawerRect.left - hostRect.left;
      const origY = drawerRect.top - hostRect.top;
      let moved = false;
      let latestPos = { x: Math.round(origX), y: Math.round(origY) };

      drawer.classList.add("is-moving");

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > 4) moved = true;
        if (!moved) return;
        const maxX = Math.max(12, host.clientWidth - drawer.offsetWidth - 12);
        const maxY = Math.max(12, host.clientHeight - drawer.offsetHeight - 12);
        const nx = Math.round(Math.max(12, Math.min(origX + dx, maxX)));
        const ny = Math.round(Math.max(12, Math.min(origY + dy, maxY)));
        latestPos = { x: nx, y: ny };
        drawer.setCssProps({ "--jce-outline-x": `${nx}px`, "--jce-outline-y": `${ny}px` });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        drawer.classList.remove("is-moving");
        const filePath = this.opts.getFilePath(canvas);
        if (moved && filePath) {
          const curPrefs = this.opts.getPrefs(filePath);
          this.opts.setPrefs(filePath, { ...curPrefs, pos: latestPos });
        } else if (!moved && st.compact) {
          st.compact = false;
          this.animateCompact(drawer, false);
        }
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    });
  }

  private jumpToSection(canvas: CanvasLike, st: OutlineUiState, sectionId: string): void {
    const node = canvas.nodes.get(sectionId);
    if (!node) return;
    st.activeSectionId = sectionId;
    focusNodeInViewport(canvas, node);
    canvas.selectOnly(node);
    this.pulseNode(node);
    this.render(canvas, true);
  }

  private pulseNode(node: NodeLike): void {
    const el = node.nodeEl;
    if (!el) return;
    const prev = this.pulseTimers.get(node);
    if (prev) window.clearTimeout(prev);
    el.classList.remove("jce-outline-pulse");
    window.requestAnimationFrame(() => {
      el.classList.add("jce-outline-pulse");
      const timer = window.setTimeout(() => {
        el.classList.remove("jce-outline-pulse");
        this.pulseTimers.delete(node);
      }, 1250);
      this.pulseTimers.set(node, timer);
    });
  }
}
