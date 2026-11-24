/**
 * search.ts — in-canvas node search bar (⌘F / toolbar magnifying glass).
 */

import { setIcon } from "obsidian";
import { CanvasLike, NodeLike, focusNodeInViewport } from "./bridge";
import { isGroupNode, kindOf, nodeTextContent, nodeTitleOf } from "./model";

type SearchHit = {
  node: NodeLike;
  title: string;
  snippet: string;
  kindLabel: string;
};

type SearchState = {
  barEl: HTMLElement;
  inputEl: HTMLInputElement;
  countEl: HTMLElement;
  listEl: HTMLElement;
  hits: SearchHit[];
  index: number;
  open: boolean;
};

export class CanvasSearchBar {
  private states = new Map<CanvasLike, SearchState>();

  constructor(
    private opts: {
      onRevealNode?: (canvas: CanvasLike, nodeId: string) => void;
      onOpenChange?: (canvas: CanvasLike, open: boolean) => void;
    } = {}
  ) {}

  isOpen(canvas: CanvasLike): boolean {
    return this.states.get(canvas)?.open === true;
  }

  toggle(canvas: CanvasLike): void {
    if (this.isOpen(canvas)) this.close(canvas);
    else this.open(canvas);
  }

  open(canvas: CanvasLike): void {
    const state = this.ensureState(canvas);
    if (!state) return;
    state.open = true;
    state.barEl.hidden = false;
    this.opts.onOpenChange?.(canvas, true);
    this.runSearch(canvas, state, false);
    window.requestAnimationFrame(() => {
      state.inputEl.focus();
      state.inputEl.select();
    });
  }

  close(canvas: CanvasLike): void {
    const state = this.states.get(canvas);
    if (!state || !state.open) return;
    state.open = false;
    state.barEl.hidden = true;
    this.clearHighlights(canvas);
    this.opts.onOpenChange?.(canvas, false);
  }

  detach(canvas: CanvasLike): void {
    const state = this.states.get(canvas);
    if (!state) return;
    this.clearHighlights(canvas);
    state.barEl.remove();
    this.states.delete(canvas);
  }

  destroy(): void {
    for (const canvas of Array.from(this.states.keys())) {
      this.detach(canvas);
    }
  }

  private ensureState(canvas: CanvasLike): SearchState | null {
    const existing = this.states.get(canvas);
    if (existing && existing.barEl.isConnected) return existing;
    existing?.barEl.remove();

    const host = canvas.wrapperEl.closest(".view-content") as HTMLElement | null;
    if (!host) return null;

    const barEl = host.createDiv({ cls: "jce-search-bar" });
    barEl.hidden = true;

    const row = barEl.createDiv({ cls: "jce-search-row" });

    const icon = row.createSpan({ cls: "jce-search-icon" });
    setIcon(icon, "search");

    const inputEl = row.createEl("input", {
      type: "text",
      cls: "jce-search-input",
      attr: { placeholder: "搜索当前画布… / Search canvas" },
    });

    const countEl = row.createSpan({ cls: "jce-search-count", text: "0/0" });

    const prevBtn = row.createEl("button", {
      type: "button",
      cls: "jce-search-nav",
      attr: { title: "上一个 / Previous (Shift+Enter)", "aria-label": "Previous" },
    });
    setIcon(prevBtn, "chevron-up");

    const nextBtn = row.createEl("button", {
      type: "button",
      cls: "jce-search-nav",
      attr: { title: "下一个 / Next (Enter)", "aria-label": "Next" },
    });
    setIcon(nextBtn, "chevron-down");

    const closeBtn = row.createEl("button", {
      type: "button",
      cls: "jce-search-close",
      attr: { title: "关闭 / Close (Esc)", "aria-label": "Close" },
    });
    setIcon(closeBtn, "x");

    const listEl = barEl.createDiv({ cls: "jce-search-list" });
    listEl.hidden = true;

    const state: SearchState = {
      barEl,
      inputEl,
      countEl,
      listEl,
      hits: [],
      index: -1,
      open: false,
    };

    barEl.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    inputEl.addEventListener("input", () => this.runSearch(canvas, state, true));
    inputEl.addEventListener("keydown", (evt) => {
      if (evt.isComposing) return;
      if (evt.key === "Escape") {
        evt.preventDefault();
        evt.stopPropagation();
        this.close(canvas);
        canvas.wrapperEl.focus?.();
        return;
      }
      if (evt.key === "Enter") {
        evt.preventDefault();
        evt.stopPropagation();
        this.step(canvas, state, evt.shiftKey ? -1 : 1);
        return;
      }
      if (evt.key === "ArrowDown") {
        evt.preventDefault();
        this.step(canvas, state, 1);
        return;
      }
      if (evt.key === "ArrowUp") {
        evt.preventDefault();
        this.step(canvas, state, -1);
      }
    });
    prevBtn.addEventListener("click", () => this.step(canvas, state, -1));
    nextBtn.addEventListener("click", () => this.step(canvas, state, 1));
    closeBtn.addEventListener("click", () => this.close(canvas));

    this.states.set(canvas, state);
    return state;
  }

  private runSearch(canvas: CanvasLike, state: SearchState, jumpToFirst: boolean): void {
    const query = state.inputEl.value.trim().toLowerCase();
    this.clearHighlights(canvas);

    if (!query) {
      state.hits = [];
      state.index = -1;
      state.countEl.textContent = "0/0";
      state.listEl.hidden = true;
      state.listEl.empty();
      return;
    }

    const hits: SearchHit[] = [];
    for (const node of canvas.nodes.values()) {
      const title = nodeTitleOf(node);
      const raw = nodeTextContent(node);
      const hay = `${title}\n${raw}`.toLowerCase();
      const pos = hay.indexOf(query);
      if (pos === -1) continue;

      const rawFlat = raw.replace(/\s+/g, " ").trim();
      const rawPos = rawFlat.toLowerCase().indexOf(query);
      let snippet = "";
      if (rawPos !== -1) {
        const start = Math.max(0, rawPos - 18);
        const end = Math.min(rawFlat.length, rawPos + query.length + 34);
        snippet = (start > 0 ? "…" : "") + rawFlat.slice(start, end) + (end < rawFlat.length ? "…" : "");
      }

      hits.push({
        node,
        title,
        snippet,
        kindLabel: kindBadge(node),
      });
    }

    // Sort top-to-bottom, left-to-right for predictable navigation.
    hits.sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);
    state.hits = hits;
    state.index = hits.length > 0 ? 0 : -1;

    for (const hit of hits) {
      hit.node.nodeEl?.classList.add("jce-search-hit");
    }

    this.renderList(canvas, state);
    if (hits.length > 0 && jumpToFirst) {
      this.activateHit(canvas, state, 0);
    } else {
      this.updateCount(state);
    }
  }

  private step(canvas: CanvasLike, state: SearchState, delta: number): void {
    if (!state.hits.length) return;
    const len = state.hits.length;
    const next = state.index < 0 ? 0 : (state.index + delta + len) % len;
    this.activateHit(canvas, state, next);
  }

  private activateHit(canvas: CanvasLike, state: SearchState, index: number): void {
    const hit = state.hits[index];
    if (!hit) return;

    for (const h of state.hits) h.node.nodeEl?.classList.remove("jce-search-current");
    state.index = index;
    this.updateCount(state);

    this.opts.onRevealNode?.(canvas, hit.node.id);
    hit.node.nodeEl?.classList.add("jce-search-hit", "jce-search-current");
    canvas.selectOnly(hit.node);
    focusNodeInViewport(canvas, hit.node);

    const rows = state.listEl.querySelectorAll<HTMLElement>(".jce-search-item");
    rows.forEach((row, i) => {
      const active = i === index;
      row.classList.toggle("is-active", active);
      if (active) row.scrollIntoView({ block: "nearest" });
    });
  }

  private updateCount(state: SearchState): void {
    if (!state.hits.length) {
      state.countEl.textContent = "0/0";
      return;
    }
    state.countEl.textContent = `${state.index + 1}/${state.hits.length}`;
  }

  private renderList(canvas: CanvasLike, state: SearchState): void {
    state.listEl.empty();
    if (!state.hits.length) {
      state.listEl.hidden = true;
      return;
    }
    state.listEl.hidden = false;
    state.hits.forEach((hit, i) => {
      const item = state.listEl.createEl("button", {
        type: "button",
        cls: "jce-search-item",
      });
      item.toggleClass("is-active", i === state.index);

      item.createSpan({ cls: "jce-search-badge", text: hit.kindLabel });
      const body = item.createSpan({ cls: "jce-search-item-body" });
      body.createSpan({ cls: "jce-search-item-title", text: hit.title });

      if (hit.snippet && hit.snippet !== hit.title) {
        body.createSpan({ cls: "jce-search-item-sub", text: hit.snippet });
      }

      item.addEventListener("mousedown", (evt) => evt.preventDefault());
      item.addEventListener("click", () => this.activateHit(canvas, state, i));
    });
  }

  private clearHighlights(canvas: CanvasLike): void {
    for (const node of canvas.nodes.values()) {
      node.nodeEl?.classList.remove("jce-search-hit", "jce-search-current");
    }
  }
}

function kindBadge(node: NodeLike): string {
  const kind = kindOf(node);
  if (kind === "note") return "笔记";
  if (kind === "text") return "文字";
  if (kind === "mindmap") return "导图";
  if (isGroupNode(node)) return "分区";
  if (node.getData().type === "file") return "文件";
  return "卡片";
}
