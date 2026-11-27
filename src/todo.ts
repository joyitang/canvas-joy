/**
 * todo.ts — in-card to-dos (Heptabase parity, JOY 2026-11-19).
 *
 * Obsidian renders `- [ ]` checkboxes in a canvas card's preview, but clicking
 * one in the canvas only selects the node — the click never reaches the
 * checkbox. This module handles that click at the window capture phase so the
 * checkbox can be toggled without entering edit mode, and adds the `[ ]` + space
 * shorthand Heptabase users expect.
 *
 * Completed styling lives in styles.css.
 */

import { EditorView } from "@codemirror/view";
import type { Plugin } from "obsidian";
import { CanvasLike, NodeLike, commit } from "./bridge";

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

export class TodoController {
  constructor(private plugin: Plugin) {}

  /**
   * Window-level capture: Obsidian's canvas selects the node on pointerdown
   * before a preview checkbox could react, so the check has to be intercepted
   * first and the event stopped.
   */
  onPointerDown(evt: PointerEvent): void {
    const hit = this.hit(evt);
    if (!hit) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.toggle(hit.canvas, hit.node, hit.index);
  }

  /** The reading-view checkbox writes back through a click handler; without
   *  this it re-saves the stale line right after our toggle. */
  onClick(evt: MouseEvent): void {
    if (!this.hit(evt)) return;
    evt.preventDefault();
    evt.stopPropagation();
  }

  /** `[ ]`/`[]` + space at the start of a line becomes a task item. */
  onKeyDown(evt: KeyboardEvent, doc: Document): boolean {
    if (evt.key !== " " || evt.metaKey || evt.ctrlKey || evt.altKey || evt.isComposing) return false;
    const content = doc.querySelector(".cm-content");
    if (!(content instanceof HTMLElement)) return false;
    const view = findView(content);
    if (!view) return false;
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const line = view.state.doc.lineAt(sel.head);
    const before = view.state.sliceDoc(line.from, sel.head);
    const match = before.match(/^(\s*)\[\s?\]$/);
    if (!match) return false;

    evt.preventDefault();
    const insert = `${match[1]}- [ ] `;
    view.dispatch({
      changes: { from: line.from, to: sel.head, insert },
      selection: { anchor: line.from + insert.length },
    });
    return true;
  }

  private hit(evt: Event): { canvas: CanvasLike; node: NodeLike; index: number } | null {
    if (evt instanceof MouseEvent && evt.button !== 0) return null;
    const target = evt.target as Element | null;
    let input: HTMLInputElement | null =
      target instanceof HTMLInputElement && target.classList.contains("task-list-item-checkbox")
        ? target
        : null;
    if (!input) {
      // Canvas covers card content with a click blocker so the node can be
      // dragged; the checkbox is underneath it, so look through the blocker.
      if (!target?.classList?.contains("canvas-node-content-blocker") || !(evt instanceof MouseEvent)) return null;
      const found = document
        .elementsFromPoint(evt.clientX, evt.clientY)
        .find(
          (el): el is HTMLInputElement =>
            el.instanceOf(HTMLInputElement) && el.classList.contains("task-list-item-checkbox")
        );
      input = found ?? null;
    }
    if (!input || input.type !== "checkbox") return null;
    // In the editor native CodeMirror already toggles the box.
    if (!input.closest(".markdown-preview-view") || input.closest(".cm-editor")) return null;

    const wrapper = input.closest(".canvas-wrapper");
    if (!(wrapper instanceof HTMLElement)) return null;
    const canvas = this.canvasFor(wrapper);
    if (!canvas) return null;
    const node = this.nodeFor(canvas, input);
    if (!node) return null;

    // File-backed cards keep their markdown in a note; leave those to Obsidian.
    if (node.getData().type !== "text") return null;

    // \`data-line\` is relative to the rendered block, not the card text (a list
    // after a paragraph starts at 0 again), so map by the order of task items:
    // the preview lists them in source order.
    const item = input.closest("li.task-list-item");
    const items = Array.from(node.nodeEl.querySelectorAll("li.task-list-item"));
    const index = item ? items.indexOf(item) : -1;
    if (index < 0) return null;
    return { canvas, node, index };
  }

  private toggle(canvas: CanvasLike, node: NodeLike, taskIndex: number): void {
    const data = node.getData();
    const text = typeof data.text === "string" ? data.text : "";
    const lines = text.split("\n");
    let seen = -1;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(TASK_LINE);
      if (!match) continue;
      seen += 1;
      if (seen !== taskIndex) continue;
      const done = match[2].toLowerCase() === "x";
      lines[i] = lines[i].replace(TASK_LINE, `$1[${done ? " " : "x"}]`);
      node.setData({ ...data, text: lines.join("\n") });
      node.render?.();
      commit(canvas);
      return;
    }
  }

  private canvasFor(wrapper: HTMLElement): CanvasLike | null {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
      const canvas = (leaf.view as { canvas?: CanvasLike }).canvas;
      if (canvas?.wrapperEl === wrapper) return canvas;
    }
    return null;
  }

  private nodeFor(canvas: CanvasLike, target: Element): NodeLike | null {
    const el = target.closest(".canvas-node");
    if (!(el instanceof HTMLElement)) return null;
    for (const node of canvas.nodes.values()) {
      if (node.nodeEl === el || node.nodeEl.contains(el)) return node;
    }
    return null;
  }
}

function findView(el: HTMLElement): EditorView | null {
  try {
    const view = EditorView.findFromDOM(el);
    if (view && view.state?.selection) return view;
  } catch {
    /* not inside an editor */
  }
  return null;
}
