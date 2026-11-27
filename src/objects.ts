/**
 * objects.ts — creating the four object types (PRD §5).
 *
 * Order matters: tag + wire the object first, then start editing. Starting an
 * edit session before the structure is final is what used to lose arrows.
 */

import {
  CanvasLike,
  NodeLike,
  Point,
  commit,
  uid,
  viewportCenter,
} from "./bridge";
import { Chrome } from "./chrome";
import { DEFAULTS } from "./copy";
import { KIND_SIZE } from "./layout";
import { LAYOUT, ROOT, TAG, Kind } from "./model";
import { EditorView } from "@codemirror/view";

export type CreateOptions = {
  canvas: CanvasLike;
  kind: Kind;
  /** world position of the click; the object is centred on it */
  at?: Point;
  startEditing?: boolean;
  /** initial markdown; defaults per kind */
  text?: string;
  /** put the caret at the end once the editor opens (prefilled cards) */
  caretAtEnd?: boolean;
};

export function createObject(chrome: Chrome, opts: CreateOptions): NodeLike | undefined {
  const { canvas, kind } = opts;
  const size = KIND_SIZE[kind];
  const pos = opts.at
    ? { x: Math.round(opts.at.x - size.width / 2), y: Math.round(opts.at.y - size.height / 2) }
    : viewportCenter(canvas, size);

  let node: NodeLike | undefined;
  if (kind === "section") {
    node = canvas.createGroupNode({
      pos,
      size,
      label: DEFAULTS.section,
      focus: false,
      save: true,
    });
    if (node) tag(canvas, node, "section");
  } else {
    const text =
      opts.text ??
      (kind === "note"
        ? `# ${DEFAULTS.noteCard}\n`
        : kind === "mindmap"
          ? DEFAULTS.mindmapRoot
          : DEFAULTS.text);
    node = canvas.createTextNode({ pos, size, text, focus: false, save: true });
    if (node) {
      tag(canvas, node, kind);
      if (kind === "mindmap") {
        node.setData({ ...node.getData(), [ROOT]: node.id, [LAYOUT]: "TB" });
        canvas.requestSave();
      }
    }
  }

  if (!node) return undefined;
  commit(canvas);
  chrome.invalidate(canvas);

  if (kind !== "section" && opts.startEditing !== false) {
    startEditingWhenReady(canvas, node);
    if (opts.caretAtEnd && typeof opts.text === "string") {
      keepCaretAtEnd(canvas, node, opts.text);
    }
  } else {
    canvas.selectOnly(node);
  }
  return node;
}

export function tag(canvas: CanvasLike, node: NodeLike, kind: Kind): void {
  node.setData({ ...node.getData(), [TAG]: kind });
  canvas.requestSave();
}

/**
 * Start editing once the node element is mounted *and* the canvas owns focus.
 *
 * Two failure modes this guards against, both observed for real:
 *  - the node element is not in the DOM yet (editing silently does nothing);
 *  - focus is on `body` after the previous edit session, so `startEditing`
 *    is a no-op and the new node looks created but cannot be typed into.
 */
export function startEditingWhenReady(canvas: CanvasLike, node: NodeLike, tries = 0): void {
  const el = node.nodeEl;
  if (!el?.isConnected) {
    if (tries > 20) return;
    canvas.requestFrame();
    window.requestAnimationFrame(() => startEditingWhenReady(canvas, node, tries + 1));
    return;
  }

  if (!node.isEditing) {
    // Give the canvas keyboard focus back before opening an editor.
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      canvas.wrapperEl.focus?.();
    }
    // A node created this frame may not be rendered yet; render() makes
    // startEditing meaningful instead of a silent no-op.
    const lazyNode = node as NodeLike & { attach?: () => void; render?: () => void };
    if (tries > 0) {
      lazyNode.attach?.();
      lazyNode.render?.();
    }
    canvas.selectOnly(node);
    node.startEditing?.();
  }

  // Verify, then retry — Obsidian can swallow the edit session when it races
  // with the teardown of the previous one (its fold-save debounce fires on a
  // destroyed markdown view). Give it up to ~30 frames to settle.
  if (tries < 30) {
    canvas.requestFrame();
    window.requestAnimationFrame(() => {
      const live = canvas.nodes.get(node.id) ?? node;
      if (!live.isEditing) startEditingWhenReady(canvas, live, tries + 1);
    });
  }
}

/**
 * A prefilled card (the to-do button) opens with its text selected, and
 * Obsidian re-focuses the fresh editor a few times, dropping the caret back to
 * position 0. Re-assert the caret after the placeholder until the user types.
 */
function keepCaretAtEnd(canvas: CanvasLike, node: NodeLike, expected: string): void {
  for (const delay of [250, 600, 1000, 1400]) {
    window.setTimeout(() => {
      const live = canvas.nodes.get(node.id);
      if (!live?.isEditing) return;
      const view = cmView(live);
      if (!view || view.state.doc.toString() !== expected) return;
      placeCaretAtEnd(live);
    }, delay);
  }
}

function cmView(node: NodeLike): EditorView | null {
  const content = node.nodeEl?.querySelector("iframe")?.contentDocument?.querySelector(".cm-content");
  if (!(content instanceof HTMLElement)) return null;
  try {
    return EditorView.findFromDOM(content);
  } catch {
    return null;
  }
}

/** A prefilled card opens with everything selected; put the caret after the
 *  placeholder so the first keystroke appends instead of replacing the task. */
function placeCaretAtEnd(node: NodeLike): boolean {
  const frame = node.nodeEl?.querySelector("iframe");
  const doc = frame?.contentDocument;
  const content = doc?.querySelector(".cm-content");
  if (!(content instanceof HTMLElement)) return false;
  // CodeMirror picks the DOM selection up; setting it through the DOM is what
  // survives Obsidian re-focusing the freshly created editor.
  const view = EditorView.findFromDOM(content);
  if (view && typeof view.focus === "function") view.focus();
  const selection = doc?.getSelection();
  if (!doc || !selection) return false;
  const range = doc.createRange();
  range.selectNodeContents(content);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function newId(): string {
  return uid();
}
