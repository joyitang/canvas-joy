/**
 * align.ts — multi-select alignment & even distribution bar + pure geometry.
 *
 * Appears automatically at top-center of the canvas when >= 2 visible nodes are
 * selected (hidden when editing or when Search/Focus overlays are active to
 * avoid visual clutter; still accessible anytime from the multi-select context menu).
 */

import { setIcon } from "obsidian";
import { CanvasLike, NodeLike, Rect, commit, selectedNodes } from "./bridge";
import { ALIGN_OPS, AlignOp, menuLabel } from "./copy";

export type AlignMove = {
  id: string;
  x: number;
  y: number;
};

const ICON_FOR_OP: Record<AlignOp, string> = {
  left: "align-start-vertical",
  centerX: "align-center-vertical",
  right: "align-end-vertical",
  top: "align-start-horizontal",
  centerY: "align-center-horizontal",
  bottom: "align-end-horizontal",
  distX: "align-horizontal-distribute-center",
  distY: "align-vertical-distribute-center",
};

const OP_ORDER: AlignOp[] = [
  "left",
  "centerX",
  "right",
  "top",
  "centerY",
  "bottom",
  "distX",
  "distY",
];

/** Pure geometry computation for aligning or evenly distributing rectangles. */
export function computeAlignMoves(
  items: { id: string; rect: Rect }[],
  op: AlignOp
): AlignMove[] {
  if (items.length < 2) return [];

  if (op === "distX" || op === "distY") {
    if (items.length < 3) return [];
    const horiz = op === "distX";
    const sorted = [...items].sort((a, b) =>
      horiz
        ? a.rect.x - b.rect.x || a.rect.y - b.rect.y
        : a.rect.y - b.rect.y || a.rect.x - b.rect.x
    );
    const first = sorted[0].rect;
    const last = sorted[sorted.length - 1].rect;
    const span = horiz
      ? last.x + last.width - first.x
      : last.y + last.height - first.y;
    const totalSize = sorted.reduce(
      (sum, it) => sum + (horiz ? it.rect.width : it.rect.height),
      0
    );
    const gap = (span - totalSize) / (sorted.length - 1);

    let cursor = horiz ? first.x : first.y;
    const moves: AlignMove[] = [];
    for (const it of sorted) {
      const targetX = horiz ? Math.round(cursor) : it.rect.x;
      const targetY = horiz ? it.rect.y : Math.round(cursor);
      moves.push({ id: it.id, x: targetX, y: targetY });
      cursor += (horiz ? it.rect.width : it.rect.height) + gap;
    }
    return moves;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { rect } of items) {
    minX = Math.min(minX, rect.x);
    maxX = Math.max(maxX, rect.x + rect.width);
    minY = Math.min(minY, rect.y);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  return items.map(({ id, rect }) => {
    let x = rect.x;
    let y = rect.y;
    switch (op) {
      case "left":
        x = Math.round(minX);
        break;
      case "centerX":
        x = Math.round(midX - rect.width / 2);
        break;
      case "right":
        x = Math.round(maxX - rect.width);
        break;
      case "top":
        y = Math.round(minY);
        break;
      case "centerY":
        y = Math.round(midY - rect.height / 2);
        break;
      case "bottom":
        y = Math.round(maxY - rect.height);
        break;
    }
    return { id, x, y };
  });
}

export function applyAlignment(canvas: CanvasLike, op: AlignOp, nodes?: NodeLike[]): boolean {
  const targets = (nodes ?? visibleSelectedNodes(canvas)).filter(
    (n) => !n.nodeEl.classList.contains("jce-sec-hidden")
  );
  const minCount = op === "distX" || op === "distY" ? 3 : 2;
  if (targets.length < minCount) return false;

  const moves = computeAlignMoves(
    targets.map((n) => ({
      id: n.id,
      rect: { x: n.x, y: n.y, width: n.width, height: n.height },
    })),
    op
  );
  if (!moves.length) return false;

  const changed = moves.some((m) => {
    const n = canvas.nodes.get(m.id);
    return n && (Math.round(n.x) !== m.x || Math.round(n.y) !== m.y);
  });
  if (!changed) return false;

  for (const m of moves) {
    const node = canvas.nodes.get(m.id);
    if (!node) continue;
    node.setData({ ...node.getData(), x: m.x, y: m.y });
    if (typeof node.moveAndResize === "function") {
      node.moveAndResize({ x: m.x, y: m.y, width: node.width, height: node.height });
    } else {
      node.x = m.x;
      node.y = m.y;
    }
    node.render?.();
  }

  commit(canvas);
  return true;
}

export function visibleSelectedNodes(canvas: CanvasLike): NodeLike[] {
  return selectedNodes(canvas).filter(
    (n) => !n.nodeEl.classList.contains("jce-sec-hidden")
  );
}

type AlignBarState = {
  barEl: HTMLElement;
  distBtns: HTMLButtonElement[];
};

export class AlignBar {
  private states = new Map<CanvasLike, AlignBarState>();

  constructor(
    private opts: {
      onAlign: (canvas: CanvasLike, op: AlignOp) => void;
      isSuppressed?: (canvas: CanvasLike) => boolean;
    }
  ) {}

  sync(canvas: CanvasLike): void {
    const sel = visibleSelectedNodes(canvas);
    const suppressed = this.opts.isSuppressed?.(canvas) === true;
    const show = !suppressed && sel.length >= 2;

    if (!show) {
      const existing = this.states.get(canvas);
      if (existing) existing.barEl.hidden = true;
      return;
    }

    const state = this.ensureState(canvas);
    if (!state) return;
    state.barEl.hidden = false;
    const canDist = sel.length >= 3;
    for (const btn of state.distBtns) {
      btn.disabled = !canDist;
      btn.toggleClass("is-disabled", !canDist);
    }
  }

  detach(canvas: CanvasLike): void {
    const state = this.states.get(canvas);
    if (!state) return;
    state.barEl.remove();
    this.states.delete(canvas);
  }

  destroy(): void {
    for (const canvas of Array.from(this.states.keys())) {
      this.detach(canvas);
    }
  }

  private ensureState(canvas: CanvasLike): AlignBarState | null {
    const existing = this.states.get(canvas);
    if (existing && existing.barEl.isConnected) return existing;
    existing?.barEl.remove();

    const host = canvas.wrapperEl.closest(".view-content");
    if (!host) return null;

    const barEl = host.createDiv({
      cls: "jce-align-bar",
      attr: { role: "toolbar", "aria-label": "对齐与分布 / Align & distribute" },
    });
    barEl.hidden = true;
    barEl.addEventListener("pointerdown", (evt) => evt.stopPropagation());

    const distBtns: HTMLButtonElement[] = [];
    OP_ORDER.forEach((op, idx) => {
      if (idx === 3 || idx === 6) {
        barEl.createDiv({ cls: "jce-align-sep" });
      }
      const label = menuLabel(ALIGN_OPS[op]);
      const btn = barEl.createEl("button", {
        type: "button",
        cls: "jce-align-btn",
        attr: {
          "data-align": op,
          title: label,
          "aria-label": label,
        },
      });
      setIcon(btn, ICON_FOR_OP[op]);
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (btn.disabled) return;
        this.opts.onAlign(canvas, op);
      });
      if (op === "distX" || op === "distY") distBtns.push(btn);
    });

    const state: AlignBarState = { barEl, distBtns };
    this.states.set(canvas, state);
    return state;
  }
}
