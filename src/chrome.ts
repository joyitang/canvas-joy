/**
 * chrome.ts — keeps the DOM in sync with the model.
 *
 * Responsibilities:
 *  - tag node elements with their kind class (CSS-only styling)
 *  - paint editing iframes transparent for mindmap nodes (PRD MM-02)
 *  - suppress native mindmap chrome (PRD MM-08)
 *  - hide folded subtrees and native edges we replace with our own lines
 *  - redraw the world-space overlay
 *
 * A cheap signature short-circuits no-op refreshes, so this can be driven from
 * every canvas frame without measurable cost.
 */

import type { Plugin } from "obsidian";
import { CanvasLike, NodeLike, allNodes, isEditing, scaleOf } from "./bridge";
import {
  cardBgOf,
  foldKidsOf,
  hiddenByFold,
  isCardFolded,
  kindOf,
  mindmapEdges,
  mindmapNodeIds,
  nodeTextContent,
} from "./model";
import { drawOverlay } from "./overlay";

const KIND_CLASSES = ["jce-note", "jce-text", "jce-mindmap", "jce-section"];
const IFRAME_STYLE_ID = "jce-iframe-style";

/** Editing happens in a fresh iframe per session, so the transparent paint is
 *  re-injected every time. Note cards use the base rule: they keep the normal
 *  text layout and only need the white block to go away. */
const BASE_IFRAME_CSS = `
html, body {
  background: transparent !important;
  background-color: transparent !important;
  margin: 0 !important;
}
:root {
  --background-primary: transparent !important;
  --background-primary-alt: transparent !important;
  --background-secondary: transparent !important;
  --background-secondary-alt: transparent !important;
  --background-modifier-form-field: transparent !important;
  --code-background: transparent !important;
  --embed-background: transparent !important;
  --canvas-color: transparent !important;
}

.markdown-source-view, .markdown-reading-view, .markdown-preview-view,
.cm-editor, .cm-scroller, .cm-content, .cm-contentContainer, .cm-line,
.markdown-embed, .markdown-embed-content {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
}
.cm-editor { height: 100% !important; }
.cm-scroller { font-size: var(--font-text-size, 16px); }
/* Obsidian reveals the == markers for about a second after the selection
 * changes, which reads as "my highlight turned into source code". The card is
 * WYSIWYG here: the markers stay hidden, toggling H off works from the
 * surrounding characters. */
.cm-formatting-highlight { display: none !important; }
/* Completed tasks read the same in the editor as in the preview. */
.cm-line.HyperMD-task-line[data-task="x"],
.cm-line.HyperMD-task-line[data-task="X"] {
  color: var(--text-faint) !important;
  text-decoration: line-through !important;
  text-decoration-thickness: 1px;
}
`;

/** Native/text cards only need the highlight markers hidden; their own
 *  background handling stays untouched. */
const HIGHLIGHT_IFRAME_CSS = `
.cm-formatting-highlight { display: none !important; }
.cm-line.HyperMD-task-line[data-task="x"],
.cm-line.HyperMD-task-line[data-task="X"] {
  color: var(--text-faint) !important;
  text-decoration: line-through !important;
  text-decoration-thickness: 1px;
}
`;

const MINDMAP_IFRAME_CSS = `
${BASE_IFRAME_CSS}
.cm-scroller {
  overflow: hidden !important;
}
.cm-content {
  text-align: center !important;
  padding: 6px 10px !important;
  min-height: 0 !important;
}
`;

export class Chrome {
  private observers = new WeakMap<CanvasLike, MutationObserver>();
  private signatures = new WeakMap<CanvasLike, string>();
  private scheduled = new WeakSet<CanvasLike>();
  private paintedFrames = new WeakSet<HTMLIFrameElement>();

  constructor(
    private plugin: Plugin,
    private onApplied?: (canvas: CanvasLike) => void
  ) {}

  attach(canvas: CanvasLike): void {
    if (this.observers.has(canvas)) {
      this.schedule(canvas);
      return;
    }
    const observer = new MutationObserver(() => this.schedule(canvas));
    // childList only: our own class/style tweaks are attribute changes, so they
    // never re-trigger the observer (no feedback loop).
    observer.observe(canvas.canvasEl, { childList: true, subtree: true });
    this.observers.set(canvas, observer);
    this.schedule(canvas);
  }

  detach(canvas: CanvasLike): void {
    this.observers.get(canvas)?.disconnect();
    this.observers.delete(canvas);
    this.signatures.delete(canvas);
  }

  schedule(canvas: CanvasLike): void {
    if (this.scheduled.has(canvas)) return;
    this.scheduled.add(canvas);
    requestAnimationFrame(() => {
      this.scheduled.delete(canvas);
      this.sync(canvas);
    });
  }

  /** Force the next sync to do full work (after structural changes). */
  invalidate(canvas: CanvasLike): void {
    this.signatures.delete(canvas);
    this.schedule(canvas);
  }

  sync(canvas: CanvasLike): void {
    const signature = this.signatureOf(canvas);
    if (this.signatures.get(canvas) === signature) return;
    this.signatures.set(canvas, signature);
    this.apply(canvas);
  }

  private signatureOf(canvas: CanvasLike): string {
    const parts: string[] = [
      `z${Math.round(scaleOf(canvas) * 100)}${canvas.wrapperEl.classList.contains("mod-zoomed-out") ? "o" : ""}`,
    ];
    for (const node of allNodes(canvas)) {
      const text = nodeTextContent(node);
      parts.push(
        [
          node.id,
          kindOf(node) ?? "-",
          Math.round(node.x),
          Math.round(node.y),
          Math.round(node.width),
          Math.round(node.height),
          node.color ?? "",
          cardBgOf(node),
          isEditing(node) ? "e" : "",
          node.getData().jceFold === true ? "f" : "",
          isCardFolded(node) ? `cf${foldKidsOf(node).length}` : "",
          `${text.length}:${text.slice(0, 48)}`,
        ].join(":")
      );
    }
    for (const item of canvas.selection ?? []) {
      if (item?.id) parts.push(`s${item.id}`);
    }
    parts.sort();
    return parts.join("|");
  }

  private apply(canvas: CanvasLike): void {
    const mmIds = mindmapNodeIds(canvas);

    for (const node of allNodes(canvas)) {
      this.paintNode(node);
    }

    // PRD MM-08: no native selection menu while a mindmap node is selected.
    const mmSelected = Array.from(canvas.selection ?? []).some((n) => !!n?.id && mmIds.has(n.id));
    canvas.wrapperEl.classList.toggle("jce-mm-selected", mmSelected);

    // Folding: hide descendants, mark folded parents.
    const hidden = hiddenByFold(canvas);
    for (const node of allNodes(canvas)) {
      const isMm = mmIds.has(node.id);
      node.nodeEl.classList.toggle("jce-mm-hidden", isMm && hidden.has(node.id));
      const folded = node.getData().jceFold === true;
      node.nodeEl.classList.toggle("jce-has-fold", isMm && folded);
    }

    // Replace native mindmap edges with our own hierarchy lines.
    for (const edge of mindmapEdges(canvas)) {
      edge.lineGroupEl?.classList.add("jce-hide-native");
      edge.lineEndGroupEl?.classList.add("jce-hide-native");
    }

    this.paintFrames(canvas, mmIds);
    drawOverlay(canvas);
    this.onApplied?.(canvas);
  }

  paintNode(node: NodeLike): void {
    const kind = kindOf(node);
    const el = node.nodeEl;
    if (!el) return;
    for (const cls of KIND_CLASSES) {
      if (!kind || cls !== `jce-${kind}`) el.classList.remove(cls);
    }
    if (kind) {
      el.classList.add("jce-node", `jce-${kind}`);
      el.classList.toggle("jce-section-tinted", kind === "section" && !!node.color);
    }
    // Card background is a per-card choice stored in the .canvas file.
    const bg = kind === "note" ? cardBgOf(node) : "";
    if (bg && /^#[0-9a-f]{3,8}$/i.test(bg)) el.setCssProps({ "--jce-note-bg": bg });
    else el.setCssProps({ "--jce-note-bg": "" });
  }

  /** Editing happens inside a same-origin iframe that Obsidian recreates each
   *  time; paint it on every appearance. Note cards need the white block to go
   *  away as well, otherwise the chosen card colour is hidden while editing. */
  private paintFrames(canvas: CanvasLike, mmIds: Set<string>): void {
    for (const node of allNodes(canvas)) {
      const mindmap = mmIds.has(node.id);
      const note = kindOf(node) === "note";
      const css = mindmap ? MINDMAP_IFRAME_CSS : note ? BASE_IFRAME_CSS : HIGHLIGHT_IFRAME_CSS;
      const frames = node.nodeEl.querySelectorAll("iframe");
      frames.forEach((frame) => {
        this.paintFrame(frame, css);
        if (!this.paintedFrames.has(frame)) {
          this.paintedFrames.add(frame);
          frame.addEventListener("load", () => this.paintFrame(frame, css));
        }
      });
    }
  }

  paintFrame(frame: HTMLIFrameElement, css: string): void {
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return; // cross-origin, nothing we can do
    }
    if (!doc?.documentElement) return;
    let style = doc.getElementById(IFRAME_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = IFRAME_STYLE_ID;
      (doc.head ?? doc.documentElement).appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }
}
