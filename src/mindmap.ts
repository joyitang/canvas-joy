/**
 * mindmap.ts — Tab children, subtree dragging, fold/unfold and rotate.
 */

import { FileView, type Plugin } from "obsidian";
import {
  CanvasLike,
  NodeLike,
  Side,
  commit,
  createEdge,
  isEditing,
  nodeFromEvent,
  selectedNodes,
  isInsideCanvasUi,
} from "./bridge";
import { Chrome } from "./chrome";
import {
  LAYOUT,
  Layout,
  ROOT,
  TAG,
  childrenOf,
  dataOf,
  isMindmap,
  isFolded,
  kindOf,
  nextLayout,
  rootIdOf,
  rootIds,
  treeOf,
} from "./model";
import { childPosition, inheritedSize, KIND_SIZE } from "./layout";
import { startEditingWhenReady } from "./objects";

const SIDES: Record<Layout, { from: Side; to: Side }> = {
  TB: { from: "bottom", to: "top" },
  BT: { from: "top", to: "bottom" },
  LR: { from: "right", to: "left" },
  RL: { from: "left", to: "right" },
};

export class MindmapController {
  private drag: { canvas: CanvasLike; nodeId: string; moved: boolean; x: number; y: number } | null =
    null;

  constructor(
    private plugin: Plugin,
    private chrome: Chrome
  ) {
    this.installPointerDrag();
  }

  // ---------------------------------------------------------------- children

  /** PRD MM-03..MM-06: create a real child node, keep existing siblings put,
   *  inherit size, and wire the parent→child arrow before editing starts. */
  addChild(canvas: CanvasLike, parentId: string): NodeLike | undefined {
    const parent = canvas.nodes.get(parentId);
    if (!parent || !isMindmap(parent)) return undefined;

    const rootId = rootIdOf(parent) ?? parent.id;
    const tree = treeOf(canvas, rootId);
    const layout = tree.layout;

    const siblings = childrenOf(canvas, parentId);
    const size = inheritedSize(parent, siblings.map((s) => ({ width: s.width, height: s.height })));
    const pos = childPosition(parent, siblings, size, layout);

    const child = canvas.createTextNode({ pos, size, text: "", focus: false, save: true });
    if (!child) return undefined;

    child.setData({ ...child.getData(), [TAG]: "mindmap", [ROOT]: rootId });

    // Unfold the parent: a new child would otherwise be created invisible.
    if (dataOf(parent).jceFold === true) {
      parent.setData({ ...parent.getData(), jceFold: false });
    }

    // Arrow first, edit second (this ordering is what keeps MM-06 honest).
    createEdge(canvas, parent, child, SIDES[layout]);

    commit(canvas);
    this.chrome.invalidate(canvas);
    // Editing starts after the structure is final (arrow already wired).
    startEditingWhenReady(canvas, child);
    return child;
  }

  // -------------------------------------------------------------------- fold

  setFolded(canvas: CanvasLike, nodeId: string, folded: boolean): void {
    const node = canvas.nodes.get(nodeId);
    if (!node) return;
    node.setData({ ...node.getData(), jceFold: folded });
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }

  folded(canvas: CanvasLike, nodeId: string): boolean {
    return isFolded(canvas, nodeId);
  }

  // ------------------------------------------------------------------ rotate

  /**
   * Rotate the branch direction by 90° clockwise (TB → LR → BT → RL).
   * PRD MM-10 requires a Rotate action but leaves direction/step open; this is
   * a documented proposal, not a confirmed user decision.
   */
  rotate(canvas: CanvasLike, nodeId: string): void {
    const node = canvas.nodes.get(nodeId);
    if (!node || !isMindmap(node)) return;
    const rootId = rootIdOf(node) ?? node.id;
    const root = canvas.nodes.get(rootId);
    if (!root) return;
    const layout = nextLayout((dataOf(root)[LAYOUT] as Layout) ?? "TB");
    root.setData({ ...root.getData(), [LAYOUT]: layout });
    this.relayout(canvas, root, layout);
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }

  /** Re-place descendants of `root` for a new orientation; root itself stays. */
  private relayout(canvas: CanvasLike, root: NodeLike, layout: Layout): void {
    const walk = (parent: NodeLike) => {
      const kids = childrenOf(canvas, parent.id);
      const placed: { width: number; height: number; x: number; y: number }[] = [];
      for (const kid of kids) {
        const size = { width: kid.width, height: kid.height };
        const pos = childPosition(parent, placed, size, layout);
        kid.moveAndResize?.({ ...pos, width: size.width, height: size.height });
        placed.push({ ...pos, ...size });
        const edge = Array.from(canvas.edges.values()).find(
          (e) => e.from.node.id === parent.id && e.to.node.id === kid.id
        );
        edge?.update?.(
          { node: parent, side: SIDES[layout].from, end: "none" },
          { node: kid, side: SIDES[layout].to, end: "arrow" }
        );
        walk(kid);
      }
    };
    walk(root);
  }

  // ------------------------------------------------------------ subtree drag

  /**
   * PRD MM-09: dragging a parent (or any middle node) moves the whole subtree.
   *
   * Instead of fighting Obsidian's drag manager by writing positions from a
   * pointermove handler, we pre-select the subtree on pointerdown so the
   * native drag moves every descendant with correct edge/z-index updates.
   */
  private installPointerDrag(): void {
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt: PointerEvent) => this.onPointerDown(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointermove",
      (evt: PointerEvent) => {
        const drag = this.drag;
        if (!drag) return;
        if (Math.abs(evt.clientX - drag.x) > 3 || Math.abs(evt.clientY - drag.y) > 3) {
          drag.moved = true;
        }
      },
      true
    );
    const finish = () => this.onPointerUp();
    this.plugin.registerDomEvent(document, "pointerup", finish, true);
    this.plugin.registerDomEvent(window, "pointerup", finish, true);
  }

  private onPointerDown(evt: PointerEvent): void {
    this.drag = null;
    if (evt.button !== 0) return;
    if (evt.shiftKey || evt.metaKey || evt.ctrlKey || evt.altKey) return;
    const view = activeCanvasView(this.plugin);
    if (!view) return;
    const canvas = view;
    if (isInsideCanvasUi(evt.target as Element)) return;

    const node = nodeFromEvent(canvas, evt);
    if (!node || !isMindmap(node)) return;
    if (isEditing(node)) return;

    const rootId = rootIdOf(node) ?? node.id;
    const tree = treeOf(canvas, rootId);
    const subtree = [node.id, ...collectDescendants(tree, node.id)];
    if (subtree.length < 2) return;

    // Pre-select the subtree so the native drag carries every descendant.
    canvas.deselectAll();
    for (const id of subtree) {
      const member = canvas.nodes.get(id);
      if (member) canvas.select(member);
    }
    this.drag = { canvas, nodeId: node.id, moved: false, x: evt.clientX, y: evt.clientY };
  }

  private onPointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag || !drag.moved) {
      // A plain click on a parent should select just that node again.
      const node = drag?.canvas.nodes.get(drag.nodeId);
      if (node) {
        drag!.canvas.deselectAll();
        drag!.canvas.selectOnly(node);
      }
    }
    if (drag) this.chrome.schedule(drag.canvas);
  }

  // ------------------------------------------------------------------ create

  /** Wrap an existing plain canvas text node into a mindmap root. */
  adoptAsRoot(canvas: CanvasLike, node: NodeLike): void {
    node.setData({ ...node.getData(), [TAG]: "mindmap", [ROOT]: node.id, [LAYOUT]: "TB" });
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }

  rootIds(canvas: CanvasLike): string[] {
    return rootIds(canvas);
  }

  /** The mindmap node currently selected or being edited, if any. */
  activeNode(canvas: CanvasLike): NodeLike | undefined {
    const selected = selectedNodes(canvas).filter((n) => kindOf(n) === "mindmap");
    if (selected.length === 1) return selected[0];
    for (const node of canvas.nodes.values()) {
      if (isEditing(node) && isMindmap(node)) return node;
    }
    return undefined;
  }

  isRoot(canvas: CanvasLike, nodeId: string): boolean {
    const node = canvas.nodes.get(nodeId);
    return !!node && isMindmap(node) && rootIdOf(node) === nodeId;
  }

  static defaultSize() {
    return KIND_SIZE.mindmap;
  }
}

function collectDescendants(tree: ReturnType<typeof treeOf>, id: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const child of tree.children.get(current) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}

/** Active canvas, or null. */
export function activeCanvasView(plugin: Plugin): CanvasLike | null {
  const view = plugin.app.workspace.getActiveViewOfType(FileView);
  if (!view || view.getViewType() !== "canvas") return null;
  return (view as unknown as { canvas?: CanvasLike }).canvas ?? null;
}
