/**
 * collapse.ts — Heptabase-style card & section collapse.
 *
 * - Non-mindmap content cards (top-level or inside a section) collapse into a
 *   compact ~48px title pill while preserving their original height (`jceFoldH`)
 *   and background color in the `.canvas` file.
 * - Sections/groups collapse into a ~44px header bar with a child-count badge,
 *   hiding their contained children and attached edges; dragging a collapsed
 *   section translates its hidden children by the same delta.
 */

import { setIcon } from "obsidian";
import {
  CanvasLike,
  NodeLike,
  Point,
  Rect,
  allEdges,
  allNodes,
  commit,
} from "./bridge";
import { KIND_SIZE } from "./layout";
import {
  CARD_FOLD,
  FOLD_HEIGHT,
  FOLD_KIDS,
  foldHeightOf,
  foldKidsOf,
  isCardFolded,
  isCollapsible,
  isGroupNode,
  kindOf,
  nodeTextContent,
  nodeTitleOf,
  nodesInsideGroup,
  todoProgressOf,
} from "./model";

export const COLLAPSED_CARD_H = 48;
export const COLLAPSED_GROUP_H = 44;
const MIN_EXPANDED_H = 72;
const MIN_GROUP_EXPANDED_H = 140;

export class CardCollapseController {
  private lastGroupPos = new WeakMap<NodeLike, Point>();

  toggle(canvas: CanvasLike, nodeId: string): void {
    const node = canvas.nodes.get(nodeId);
    if (!node || !isCollapsible(node)) return;
    if (isCardFolded(node)) this.expand(canvas, node);
    else this.collapse(canvas, node);
  }

  collapse(canvas: CanvasLike, node: NodeLike): void {
    if (!isCollapsible(node) || isCardFolded(node)) return;
    if (node.isEditing) node.blur?.();

    const isGroup = isGroupNode(node);
    const prevH = Math.max(
      Math.round(node.height),
      isGroup ? MIN_GROUP_EXPANDED_H : MIN_EXPANDED_H
    );
    const targetH = isGroup ? COLLAPSED_GROUP_H : COLLAPSED_CARD_H;

    const patch: Record<string, unknown> = {
      ...node.getData(),
      height: targetH,
      [CARD_FOLD]: true,
      [FOLD_HEIGHT]: prevH,
    };

    if (isGroup) {
      const kids = nodesInsideGroup(canvas, node).map((k) => k.id);
      patch[FOLD_KIDS] = kids;
      this.lastGroupPos.set(node, { x: node.x, y: node.y });
    }

    node.setData(patch as ReturnType<NodeLike["getData"]>);
    setNodeRect(node, { x: node.x, y: node.y, width: node.width, height: targetH });
    commit(canvas);
    this.sync(canvas);
  }

  expand(canvas: CanvasLike, node: NodeLike): void {
    if (!isCardFolded(node)) return;
    const isGroup = isGroupNode(node);
    if (isGroup) this.translateFoldedChildren(canvas, node);
    const fallbackH = isGroup
      ? KIND_SIZE.section.height
      : kindOf(node) === "text"
        ? KIND_SIZE.text.height
        : KIND_SIZE.note.height;
    const restoredH = Math.max(
      foldHeightOf(node) ?? fallbackH,
      isGroup ? MIN_GROUP_EXPANDED_H : MIN_EXPANDED_H
    );

    const next = { ...node.getData(), height: restoredH } as Record<string, unknown>;
    delete next[CARD_FOLD];
    delete next[FOLD_HEIGHT];
    delete next[FOLD_KIDS];

    node.setData(next as ReturnType<NodeLike["getData"]>);
    setNodeRect(node, { x: node.x, y: node.y, width: node.width, height: restoredH });
    this.lastGroupPos.delete(node);
    commit(canvas);
    this.sync(canvas);
  }

  /** Expand any folded section that currently hides `nodeId` (e.g. from Search). */
  expandContainingGroup(canvas: CanvasLike, nodeId: string): void {
    for (const node of allNodes(canvas)) {
      if (!isGroupNode(node) || !isCardFolded(node)) continue;
      if (foldKidsOf(node).includes(nodeId)) {
        this.expand(canvas, node);
      }
    }
  }

  sync(canvas: CanvasLike): void {
    const nodes = allNodes(canvas);

    // 1. Translate hidden children if a folded section was dragged, and auto-expand
    //    any folded card whose height was manually dragged taller by the user.
    for (const node of nodes) {
      if (!isCollapsible(node) || !isCardFolded(node)) continue;
      const isGroup = isGroupNode(node);
      const maxFoldH = (isGroup ? COLLAPSED_GROUP_H : COLLAPSED_CARD_H) + 20;
      if (node.height > maxFoldH) {
        const next = { ...node.getData() } as Record<string, unknown>;
        delete next[CARD_FOLD];
        delete next[FOLD_HEIGHT];
        delete next[FOLD_KIDS];
        node.setData(next as ReturnType<NodeLike["getData"]>);
        this.lastGroupPos.delete(node);
        canvas.requestSave();
        continue;
      }

      if (isGroup) {
        this.translateFoldedChildren(canvas, node);
      }
    }

    // 2. Collect children hidden by folded sections.
    const hiddenBySec = new Set<string>();
    for (const node of nodes) {
      if (!isGroupNode(node) || !isCardFolded(node)) continue;
      for (const id of foldKidsOf(node)) {
        if (id !== node.id) hiddenBySec.add(id);
      }
    }

    // 3. Paint fold buttons, collapsed title pills, and hidden state.
    for (const node of nodes) {
      const hidden = hiddenBySec.has(node.id);
      node.nodeEl.classList.toggle("jce-sec-hidden", hidden);

      if (!isCollapsible(node)) {
        node.nodeEl.classList.remove("jce-card-folded", "jce-section-folded");
        node.nodeEl.querySelector(".jce-fold-btn")?.remove();
        node.nodeEl.querySelector(".jce-collapsed-bar")?.remove();
        continue;
      }

      const folded = isCardFolded(node);
      const isGroup = isGroupNode(node);
      node.nodeEl.classList.toggle("jce-card-folded", folded);
      node.nodeEl.classList.toggle("jce-section-folded", folded && isGroup);

      const host = node.containerEl;
      if (!host) continue;
      this.syncFoldButton(canvas, node, host, folded);
      this.syncCollapsedBar(canvas, node, host, folded, isGroup);
    }

    // 4. Hide edges attached to nodes hidden inside a folded section.
    for (const edge of allEdges(canvas)) {
      const hide = hiddenBySec.has(edge.from.node.id) || hiddenBySec.has(edge.to.node.id);
      edge.lineGroupEl?.classList.toggle("jce-sec-hidden", hide);
      edge.lineEndGroupEl?.classList.toggle("jce-sec-hidden", hide);
    }
  }

  detach(canvas: CanvasLike): void {
    for (const node of allNodes(canvas)) {
      node.nodeEl.classList.remove("jce-card-folded", "jce-section-folded", "jce-sec-hidden");
      node.nodeEl.querySelector(".jce-fold-btn")?.remove();
      node.nodeEl.querySelector(".jce-collapsed-bar")?.remove();
    }
    for (const edge of allEdges(canvas)) {
      edge.lineGroupEl?.classList.remove("jce-sec-hidden");
      edge.lineEndGroupEl?.classList.remove("jce-sec-hidden");
    }
  }

  private translateFoldedChildren(canvas: CanvasLike, node: NodeLike): void {
    const prev = this.lastGroupPos.get(node);
    if (!prev) {
      this.lastGroupPos.set(node, { x: node.x, y: node.y });
      return;
    }
    const dx = node.x - prev.x;
    const dy = node.y - prev.y;
    if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) return;
    for (const kidId of foldKidsOf(node)) {
      const kid = canvas.nodes.get(kidId);
      if (!kid) continue;
      const nx = Math.round(kid.x + dx);
      const ny = Math.round(kid.y + dy);
      kid.setData({ ...kid.getData(), x: nx, y: ny });
      setNodeRect(kid, { x: nx, y: ny, width: kid.width, height: kid.height });
    }
    this.lastGroupPos.set(node, { x: node.x, y: node.y });
    canvas.requestSave();
  }

  private syncFoldButton(
    canvas: CanvasLike,
    node: NodeLike,
    host: HTMLElement,
    folded: boolean
  ): void {
    let btn = host.querySelector<HTMLButtonElement>(":scope > .jce-fold-btn");
    if (!btn) {
      btn = host.createEl("button", {
        type: "button",
        cls: "jce-fold-btn",
      });
      btn.addEventListener("pointerdown", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
      });
      btn.addEventListener("dblclick", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
      });
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.toggle(canvas, node.id);
      });
    }
    const nextState = folded ? "1" : "0";
    if (btn.dataset.folded !== nextState) {
      btn.dataset.folded = nextState;
      btn.empty();
      setIcon(btn, folded ? "chevrons-down-up" : "chevrons-up-down");
      const tip = folded ? "展开 / Expand" : "折叠 / Collapse";
      btn.title = tip;
      btn.setAttribute("aria-label", tip);
    }
  }

  private syncCollapsedBar(
    canvas: CanvasLike,
    node: NodeLike,
    host: HTMLElement,
    folded: boolean,
    isGroup: boolean
  ): void {
    let bar = host.querySelector<HTMLElement>(":scope > .jce-collapsed-bar");
    if (!folded) {
      if (bar) bar.hidden = true;
      return;
    }

    if (!bar) {
      bar = host.createDiv({ cls: "jce-collapsed-bar" });
      bar.createSpan({ cls: "jce-collapsed-title" });
      bar.createSpan({ cls: "jce-collapsed-meta" });
      bar.addEventListener("dblclick", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.expand(canvas, node);
      });
    }

    bar.hidden = false;
    const title = nodeTitleOf(node);
    const meta = isGroup
      ? `${foldKidsOf(node).length} 张卡`
      : (() => {
          const p = todoProgressOf(nodeTextContent(node));
          return p ? `${p.done}/${p.total}` : "";
        })();

    const sig = `${title}\n${meta}`;
    if (bar.dataset.sig !== sig) {
      bar.dataset.sig = sig;
      const titleEl = bar.querySelector<HTMLElement>(".jce-collapsed-title");
      const metaEl = bar.querySelector<HTMLElement>(".jce-collapsed-meta");
      if (titleEl) titleEl.textContent = title;
      if (metaEl) {
        metaEl.textContent = meta;
        metaEl.hidden = !meta;
      }
    }
  }
}

function setNodeRect(node: NodeLike, rect: Rect): void {
  if (typeof node.moveAndResize === "function") {
    node.moveAndResize(rect);
  } else {
    node.x = rect.x;
    node.y = rect.y;
    node.width = rect.width;
    node.height = rect.height;
    node.resize?.({ width: rect.width, height: rect.height });
  }
  node.render?.();
}
