/**
 * format.ts — text-selection format bar (PRD §6).
 *
 * Three details drive the design:
 *
 * 1. Canvas text nodes are edited inside a same-origin iframe that Obsidian
 *    recreates for every edit session. We therefore resolve the CodeMirror
 *    view through `EditorView.findFromDOM` on the iframe's `.cm-content`
 *    instead of guessing at focus/activeElement.
 * 2. The canvas scales that iframe with a CSS transform, so an inner rect must
 *    be mapped to screen space through the iframe's actual scale ratio.
 *    Ignoring that ratio is what puts the bar in the wrong place when zoomed.
 * 3. Obsidian's Live Preview reveals inline Markdown markers on the line that
 *    holds the selection. If we leave the text selected after applying a
 *    format, the user sees `==text==` instead of a highlight. Collapsing the
 *    caret just past the closing marker puts it outside that range, so the
 *    card renders the result immediately — which is the whole point of the
 *    bar.
 */

import { EditorView } from "@codemirror/view";
import { FileView, setIcon, type Plugin } from "obsidian";
import { CanvasLike } from "./bridge";

type FormatId =
  | "bold"
  | "italic"
  | "underline"
  | "code"
  | "highlight"
  | "strike"
  | "link"
  | "math"
  | "color"
  | "bg";

type Button = { id: FormatId; glyph: string; label: string; group: number };

/**
 * Order follows the approved prototype: B I U </> H S ↗ ∑ A ▧.
 * `group` only drives the separators — Heptabase keeps the same run of tools
 * in one strip, so the separators stay hairline-thin.
 */
const BUTTONS: Button[] = [
  { id: "bold", glyph: "B", label: "粗体 / Bold  ⌘B", group: 0 },
  { id: "italic", glyph: "I", label: "斜体 / Italic  ⌘I", group: 0 },
  { id: "underline", glyph: "U", label: "下划线 / Underline  ⌘U", group: 0 },
  { id: "code", glyph: "</>", label: "行内代码 / Inline code", group: 1 },
  { id: "highlight", glyph: "H", label: "高亮 / Highlight", group: 1 },
  { id: "strike", glyph: "S", label: "删除线 / Strikethrough", group: 0 },
  { id: "link", glyph: "↗", label: "链接 / Link  ⌘K", group: 2 },
  { id: "math", glyph: "∑", label: "数学 / Math", group: 2 },
  { id: "color", glyph: "A", label: "文字颜色 / Text color", group: 3 },
  { id: "bg", glyph: "", label: "文字背景色 / Background color", group: 3 },
];

const TEXT_COLORS = ["#111111", "#6b6b6b", "#c0392b", "#d35400", "#1e8449", "#1a5276", "#6c3483"];
const BG_COLORS = ["#f7e89c", "#c8efc4", "#c5e4f7", "#f5c6d0", "#e4e4e4"];

type Target = {
  view: EditorView;
  frame: HTMLIFrameElement | null;
};

export class FormatBar {
  private el: HTMLElement;
  private colorBox: HTMLElement;
  private linkBox: HTMLElement;
  private linkInput: HTMLInputElement;
  private hooked = new WeakSet<Document>();
  private followFrame = 0;
  private syncTimer = 0;

  constructor(private plugin: Plugin) {
    this.el = document.createElement("div");
    this.el.className = "jce-format-bar";
    this.el.hidden = true;
    this.colorBox = document.createElement("div");
    this.colorBox.className = "jce-format-pop jce-format-swatches";
    this.colorBox.hidden = true;
    this.linkBox = document.createElement("div");
    this.linkBox.className = "jce-format-pop jce-format-link";
    this.linkBox.hidden = true;
    this.linkInput = document.createElement("input");
    this.build();
    document.body.appendChild(this.el);
    // Reloading the plugin must not leave an orphan bar behind.
    this.plugin.register(() => {
      this.hide();
      this.el.remove();
    });

    this.plugin.registerDomEvent(document, "mouseup", () => this.schedule(), true);
    this.plugin.registerDomEvent(document, "keyup", () => this.schedule(), true);
    this.plugin.registerDomEvent(document, "selectionchange", () => this.schedule());
    // Panning/zooming must *move* the bar, not dismiss it (PRD FMT-03), so we
    // do not hide on outside clicks; sync() hides it once the selection is gone.
    this.plugin.registerDomEvent(document, "wheel", () => this.schedule(), true);
    this.plugin.registerDomEvent(window, "resize", () => this.schedule());
  }

  // -------------------------------------------------------------------- ui

  private build(): void {
    const row = document.createElement("div");
    row.className = "jce-format-row";
    let group = -1;
    for (const btn of BUTTONS) {
      if (group !== -1 && btn.group !== group) {
        const sep = document.createElement("span");
        sep.className = "jce-format-sep";
        row.appendChild(sep);
      }
      group = btn.group;

      const el = document.createElement("button");
      el.type = "button";
      el.className = `jce-format-btn jce-fmt-${btn.id}`;
      el.dataset.fmt = btn.id;
      el.title = btn.label;
      el.setAttribute("aria-label", btn.label);
      if (btn.id === "bg") {
        // A paint bucket reads as "fill / background" far better than the
        // half-shaded square the prototype used.
        el.classList.add("jce-fmt-icon");
        setIcon(el, "paint-bucket");
      } else {
        const glyph = document.createElement("span");
        glyph.className = `jce-fmt-glyph jce-fmt-glyph-${btn.id}`;
        glyph.textContent = btn.glyph;
        el.appendChild(glyph);
      }
      el.addEventListener("mousedown", (evt) => evt.preventDefault());
      el.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.run(btn.id);
      });
      row.appendChild(el);
    }
    this.el.appendChild(row);

    this.linkInput.type = "text";
    this.linkInput.placeholder = "https://";
    this.linkInput.className = "jce-format-input";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "jce-format-apply";
    apply.textContent = "确定";
    apply.addEventListener("mousedown", (evt) => evt.preventDefault());
    apply.addEventListener("click", (evt) => {
      evt.preventDefault();
      const target = this.resolve();
      if (target) this.applyLink(target, this.linkInput.value.trim());
      this.linkBox.hidden = true;
      this.schedule();
    });
    this.linkInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        apply.click();
      } else if (evt.key === "Escape") {
        this.linkBox.hidden = true;
      }
      evt.stopPropagation();
    });
    this.linkBox.append(this.linkInput, apply);
    this.el.append(this.linkBox, this.colorBox);
  }

  hide(): void {
    this.el.hidden = true;
    this.colorBox.hidden = true;
    this.linkBox.hidden = true;
    if (this.followFrame) {
      cancelAnimationFrame(this.followFrame);
      this.followFrame = 0;
    }
  }

  // --------------------------------------------------------------- resolve

  /** The editing surface under the current text selection, if any. */
  private resolve(): Target | null {
    for (const frame of this.frames()) {
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        continue;
      }
      if (!doc) continue;
      this.hook(doc);
      const selection = doc.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) continue;
      const content = doc.querySelector(".cm-content");
      if (!content) continue;
      const view = findView(content as HTMLElement);
      if (view && !view.state.selection.main.empty) return { view, frame };
    }
    return null;
  }

  private frames(): HTMLIFrameElement[] {
    const canvas = this.activeCanvas();
    if (!canvas) return [];
    return Array.from(canvas.canvasEl.querySelectorAll<HTMLIFrameElement>(".canvas-node iframe"));
  }

  private activeCanvas(): CanvasLike | null {
    const view = this.plugin.app.workspace.getActiveViewOfType(FileView);
    if (!view || view.getViewType() !== "canvas") return null;
    return (view as unknown as { canvas?: CanvasLike }).canvas ?? null;
  }

  /** Hook every editing iframe on a canvas (they are recreated per session). */
  hookCanvas(canvas: CanvasLike): void {
    const frames = Array.from(
      canvas.canvasEl.querySelectorAll<HTMLIFrameElement>(".canvas-node iframe")
    );
    if (!frames.length) return;
    for (const frame of frames) {
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        continue;
      }
      if (doc) this.hook(doc);
    }
  }

  private hook(doc: Document): void {
    if (this.hooked.has(doc)) return;
    this.hooked.add(doc);
    const kick = () => this.schedule();
    doc.addEventListener("mouseup", kick, true);
    doc.addEventListener("keyup", kick, true);
    doc.addEventListener("selectionchange", kick);
    doc.addEventListener("scroll", kick, true);
  }

  // ------------------------------------------------------------- placement

  /** Screen-space rect of the current selection, scale-corrected. */
  private selectionRect(target: Target): DOMRect | null {
    const main = target.view.state.selection.main;
    if (main.empty) return null;
    const coords = target.view.coordsAtPos;
    if (typeof coords !== "function") return null;
    const a = coords.call(target.view, main.from, 1);
    const b = coords.call(target.view, main.to, -1);
    if (!a || !b) return null;

    const left = Math.min(a.left, b.left);
    const right = Math.max(a.right ?? a.left, b.right ?? b.left);
    const top = Math.min(a.top, b.top);
    const bottom = Math.max(a.bottom, b.bottom);
    const inner = new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));

    const frame = target.frame;
    if (!frame) return inner;
    const box = frame.getBoundingClientRect();
    const win = frame.contentWindow;
    const vw = win?.innerWidth || box.width || 1;
    const vh = win?.innerHeight || box.height || 1;
    // Canvas zoom scales the iframe; the document inside keeps its own units.
    const sx = box.width / vw;
    const sy = box.height / vh;
    return new DOMRect(
      box.left + inner.left * sx,
      box.top + inner.top * sy,
      inner.width * sx,
      inner.height * sy
    );
  }

  private place(rect: DOMRect): void {
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    // The floating tool bar owns the left edge of the canvas; a centred bar
    // for a card near that edge would sit on top of it.
    const canvas = this.activeCanvas();
    const leftEdge = canvas ? canvas.wrapperEl.getBoundingClientRect().left : 0;
    const minLeft = leftEdge > 0 ? leftEdge + 76 : 8;
    const centered = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(window.innerWidth - width - 8, Math.max(minLeft, centered));
    // Above the selection by default; below it when there is no room
    // (Heptabase flips too, instead of clipping the bar at the window edge).
    let top = rect.top - height - 8;
    if (top < 8) top = Math.min(window.innerHeight - height - 8, rect.bottom + 8);
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  private schedule(): void {
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => this.sync(), 0);
  }

  private sync(): void {
    const target = this.resolve();
    if (!target) {
      this.hide();
      return;
    }
    const rect = this.selectionRect(target);
    if (!rect) {
      this.hide();
      return;
    }
    this.el.hidden = false;
    this.place(rect);
    this.startFollow();
  }

  private startFollow(): void {
    if (this.followFrame) return;
    const tick = () => {
      if (this.el.hidden) {
        this.followFrame = 0;
        return;
      }
      const target = this.resolve();
      const rect = target ? this.selectionRect(target) : null;
      if (!rect) {
        this.hide();
        return;
      }
      this.place(rect);
      this.followFrame = requestAnimationFrame(tick);
    };
    this.followFrame = requestAnimationFrame(tick);
  }

  // --------------------------------------------------------------- actions

  private run(id: FormatId): void {
    const target = this.resolve();
    if (!target) return;
    if (id === "link") {
      this.linkBox.hidden = !this.linkBox.hidden;
      if (!this.linkBox.hidden) this.linkInput.focus();
      return;
    }
    if (id === "color" || id === "bg") {
      this.showColors(target, id);
      return;
    }
    this.colorBox.hidden = true;
    this.linkBox.hidden = true;

    const pairs: Partial<Record<FormatId, [string, string]>> = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      underline: ["<u>", "</u>"],
      code: ["`", "`"],
      highlight: ["==", "=="],
      strike: ["~~", "~~"],
      math: ["$", "$"],
    };
    const pair = pairs[id];
    if (!pair) return;
    toggleWrap(target.view, pair[0], pair[1]);
    this.schedule();
  }

  private applyLink(target: Target, url: string): void {
    const main = target.view.state.selection.main;
    const text = target.view.state.sliceDoc(main.from, main.to);
    if (!url) return;
    const label = text || url;
    const insert = `[${label}](${url})`;
    target.view.dispatch({
      changes: { from: main.from, to: main.to, insert },
      selection: { anchor: main.from + insert.length },
    });
    target.view.focus();
  }

  private showColors(target: Target, kind: "color" | "bg"): void {
    this.linkBox.hidden = true;
    this.colorBox.hidden = false;
    this.colorBox.replaceChildren();
    const colors = kind === "color" ? TEXT_COLORS : ["clear", ...BG_COLORS];
    for (const hex of colors) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "jce-swatch";
      if (hex === "clear") {
        swatch.classList.add("is-clear");
        swatch.title = "清除 / Clear";
      } else {
        swatch.style.background = hex;
        swatch.title = hex;
      }
      swatch.addEventListener("mousedown", (evt) => evt.preventDefault());
      swatch.addEventListener("click", (evt) => {
        evt.preventDefault();
        if (hex === "clear") clearStyle(target.view, kind === "color" ? "color" : "background-color");
        else wrapStyle(target.view, kind === "color" ? "color" : "background-color", hex);
        this.colorBox.hidden = true;
        this.schedule();
      });
      this.colorBox.appendChild(swatch);
    }
  }
}

// ------------------------------------------------------------------ helpers

function findView(el: HTMLElement): EditorView | null {
  try {
    const view = EditorView.findFromDOM(el);
    if (view && view.state?.selection) return view;
  } catch {
    /* not inside an editor */
  }
  return null;
}

/** Apply an inline pair to every selected line, then park the caret outside
 *  the last inserted range so Live Preview stops showing the markers. */
function toggleWrap(view: EditorView, left: string, right: string): void {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  if (!text) return;

  if (!text.includes("\n")) {
    const caret = toggleRange(view, from, to, left, right);
    setCaret(view, caret);
    return;
  }

  // Multi-line: wrapping `a\nb` in one pair produces invalid Markdown, so
  // every line is formatted on its own — this is also what Heptabase shows.
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  let caret: number | null = null;
  for (let n = last.number; n >= first.number; n--) {
    const line = view.state.doc.line(n);
    const a = n === first.number ? Math.max(from, line.from) : line.from;
    const b = n === last.number ? Math.min(to, line.to) : line.to;
    if (!view.state.sliceDoc(a, b).trim()) continue;
    const next = toggleRange(view, a, b, left, right);
    // Bottom-up: the first line processed is the last line in the document,
    // and that is where the caret should rest.
    if (caret === null) caret = next;
  }
  setCaret(view, caret ?? to);
}

function setCaret(view: EditorView, pos: number): void {
  const docLength = view.state.doc.length;
  view.dispatch({ selection: { anchor: Math.max(0, Math.min(pos, docLength)) } });
  view.focus();
}

/** Wrap, unwrap or strip surrounding markers. Returns the caret position. */
function toggleRange(
  view: EditorView,
  from: number,
  to: number,
  left: string,
  right: string
): number {
  const text = view.state.sliceDoc(from, to);
  const inner = unwrap(text, left, right);
  if (inner !== null) {
    view.dispatch({ changes: { from, to, insert: inner } });
    return from + inner.length;
  }

  if (isMarker(view, from - left.length, left, -1) && isMarker(view, to, right, 1)) {
    view.dispatch({
      changes: [
        { from: from - left.length, to: from, insert: "" },
        { from: to, to: to + right.length, insert: "" },
      ],
    });
    return from - left.length + text.length;
  }

  const insert = left + text + right;
  view.dispatch({ changes: { from, to, insert } });
  return from + insert.length;
}

function unwrap(text: string, left: string, right: string): string | null {
  if (text.length <= left.length + right.length) return null;
  if (!text.startsWith(left) || !text.endsWith(right)) return null;
  return text.slice(left.length, text.length - right.length);
}

/** True when a marker run of `left` ends/starts exactly at `pos`. */
function isMarker(view: EditorView, pos: number, marker: string, dir: 1 | -1): boolean {
  if (pos < 0) return false;
  const docLength = view.state.doc.length;
  if (dir < 0) {
    if (pos + marker.length > docLength) return false;
    if (view.state.sliceDoc(pos, pos + marker.length) !== marker) return false;
    // `*` must not be part of `**` starting one char earlier.
    if (marker.length === 1 && pos > 0 && view.state.sliceDoc(pos - 1, pos) === marker) return false;
    return true;
  }
  if (pos + marker.length > docLength) return false;
  if (view.state.sliceDoc(pos, pos + marker.length) !== marker) return false;
  if (
    marker.length === 1 &&
    pos + 1 < docLength &&
    view.state.sliceDoc(pos + 1, pos + 2) === marker
  ) {
    return false;
  }
  return true;
}

const stylePattern = (prop: string, value: string) =>
  new RegExp(`^<span style="${prop}:\\s*${escapeRe(value)}\\s*">([\\s\\S]*)</span>$`);

const anyStylePattern = (prop: string) =>
  new RegExp(`^<span style="${prop}:\\s*[^"]+\\s*">([\\s\\S]*)</span>$`);

function wrapStyle(view: EditorView, prop: string, value: string): void {
  const main = view.state.selection.main;
  const text = view.state.sliceDoc(main.from, main.to);
  if (!text) return;

  const lines = lineRanges(view, main.from, main.to);
  let caret: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const { from, to } = lines[i];
    const seg = view.state.sliceDoc(from, to);
    if (!seg.trim()) continue;
    const same = seg.match(stylePattern(prop, value));
    if (same) {
      view.dispatch({ changes: { from, to, insert: same[1] } });
      if (caret === null) caret = from + same[1].length;
      continue;
    }
    const existing = seg.match(anyStylePattern(prop));
    const inner = existing ? existing[1] : seg;
    const insert = `<span style="${prop}: ${value}">${inner}</span>`;
    view.dispatch({ changes: { from, to, insert } });
    if (caret === null) caret = from + insert.length;
  }
  setCaret(view, caret ?? main.to);
}

function clearStyle(view: EditorView, prop: string): void {
  const main = view.state.selection.main;
  const lines = lineRanges(view, main.from, main.to);
  let caret: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const { from, to } = lines[i];
    const seg = view.state.sliceDoc(from, to);
    const existing = seg.match(anyStylePattern(prop));
    if (!existing) continue;
    view.dispatch({ changes: { from, to, insert: existing[1] } });
    if (caret === null) caret = from + existing[1].length;
  }
  setCaret(view, caret ?? main.to);
}

function lineRanges(view: EditorView, from: number, to: number): { from: number; to: number }[] {
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  const out: { from: number; to: number }[] = [];
  for (let n = first.number; n <= last.number; n++) {
    const line = view.state.doc.line(n);
    out.push({
      from: n === first.number ? Math.max(from, line.from) : line.from,
      to: n === last.number ? Math.min(to, line.to) : line.to,
    });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
