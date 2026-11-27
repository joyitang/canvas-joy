/**
 * focus.ts — Heptabase-style Focus Mode.
 *
 * Highlights only the selected node(s) (or a selected section + its inner
 * children) and dims every other node and edge on the canvas. Regular cards
 * do NOT expand to connected neighbors, per user specification.
 */

import { CanvasLike, NodeLike, allEdges, allNodes, selectedNodes } from "./bridge";
import { isGroupNode, nodesInsideGroup } from "./model";

type FocusState = {
  focusedIds: Set<string>;
  selectionSig: string;
  pillEl: HTMLElement;
};

export class FocusController {
  private states = new Map<CanvasLike, FocusState>();

  isActive(canvas: CanvasLike): boolean {
    return this.states.has(canvas);
  }

  toggle(canvas: CanvasLike): boolean {
    if (this.isActive(canvas)) {
      this.exit(canvas);
      return false;
    }
    const sel = selectedNodes(canvas);
    if (!sel.length) return false;
    this.enter(canvas, sel);
    return true;
  }

  enter(canvas: CanvasLike, targets: NodeLike[]): void {
    if (!targets.length) {
      this.exit(canvas);
      return;
    }
    const focusedIds = computeFocusIds(canvas, targets);
    const pillEl = this.ensurePill(canvas);
    const state: FocusState = {
      focusedIds,
      selectionSig: sigOf(targets),
      pillEl,
    };
    this.states.set(canvas, state);
    canvas.wrapperEl.classList.add("jce-focus-mode");
    this.applyClasses(canvas, focusedIds);
  }

  exit(canvas: CanvasLike): void {
    const state = this.states.get(canvas);
    if (!state) return;
    state.pillEl.remove();
    this.states.delete(canvas);
    canvas.wrapperEl.classList.remove("jce-focus-mode");
    for (const node of allNodes(canvas)) {
      node.nodeEl?.classList.remove("jce-focused-item");
    }
    for (const edge of allEdges(canvas)) {
      edge.lineGroupEl?.classList.remove("jce-focus-dim");
      edge.lineEndGroupEl?.classList.remove("jce-focus-dim");
    }
  }

  /** Called after selection changes or DOM refreshes. */
  sync(canvas: CanvasLike): void {
    const state = this.states.get(canvas);
    if (!state) return;

    const sel = selectedNodes(canvas);
    if (sel.length > 0) {
      const sig = sigOf(sel);
      if (sig !== state.selectionSig) {
        state.selectionSig = sig;
        state.focusedIds = computeFocusIds(canvas, sel);
      }
    }
    canvas.wrapperEl.classList.add("jce-focus-mode");
    this.applyClasses(canvas, state.focusedIds);
  }

  /** Clicking blank space while in focus mode exits cleanly. */
  onCanvasBlankClick(canvas: CanvasLike): void {
    if (!this.isActive(canvas)) return;
    this.exit(canvas);
  }

  detach(canvas: CanvasLike): void {
    this.exit(canvas);
  }

  destroy(): void {
    for (const canvas of Array.from(this.states.keys())) {
      this.exit(canvas);
    }
  }

  private applyClasses(canvas: CanvasLike, focusedIds: Set<string>): void {
    for (const node of allNodes(canvas)) {
      node.nodeEl?.classList.toggle("jce-focused-item", focusedIds.has(node.id));
    }
    for (const edge of allEdges(canvas)) {
      const keep = focusedIds.has(edge.from.node.id) && focusedIds.has(edge.to.node.id);
      edge.lineGroupEl?.classList.toggle("jce-focus-dim", !keep);
      edge.lineEndGroupEl?.classList.toggle("jce-focus-dim", !keep);
    }
  }

  private ensurePill(canvas: CanvasLike): HTMLElement {
    const existing = this.states.get(canvas)?.pillEl;
    if (existing && existing.isConnected) return existing;

    const host = canvas.wrapperEl.closest(".view-content") ?? canvas.wrapperEl;

    const pill = host.createDiv({ cls: "jce-focus-pill" });
    pill.createSpan({ cls: "jce-focus-dot" });
    pill.createSpan({ cls: "jce-focus-label", text: "聚焦模式 · 点击空白或按 Esc 退出" });

    const btn = pill.createEl("button", {
      type: "button",
      cls: "jce-focus-exit",
      text: "退出",
    });
    btn.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    btn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.exit(canvas);
    });

    return pill;
  }
}

function computeFocusIds(canvas: CanvasLike, targets: NodeLike[]): Set<string> {
  const ids = new Set<string>();
  for (const node of targets) {
    ids.add(node.id);
    if (isGroupNode(node)) {
      for (const child of nodesInsideGroup(canvas, node)) {
        ids.add(child.id);
      }
    }
  }
  return ids;
}

function sigOf(nodes: NodeLike[]): string {
  return nodes
    .map((n) => n.id)
    .sort()
    .join(",");
}
