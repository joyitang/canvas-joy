/**
 * pdf-paste.ts — Smart PDF excerpt paste cleaner & one-click card creation.
 *
 * Solves the split-screen reading pain point (Apple Preview on left, Obsidian Canvas on right):
 *  - Cleans broken mid-sentence hard line-breaks typical of PDF copy-paste (CJK joins with
 *    no space, English hyphenation rejoins cleanly, Latin joins with one space) while preserving
 *    real paragraph breaks, headings, lists, blockquotes, and code blocks.
 *  - Inside an editing card iframe: intercepts paste ONLY when broken PDF wraps are detected
 *    and inserts cleaned text via CodeMirror transaction (preserves ⌘Z undo).
 *  - On canvas (not editing): pasting plain text creates a clean Note Card directly at viewport
 *    center without interfering with native Canvas node/edge copy-paste or image paste.
 */

import { EditorView } from "@codemirror/view";
import {
  CanvasLike,
  commit,
  isInsideCanvasUi,
  viewportCenter,
} from "./bridge";
import { Chrome } from "./chrome";
import { KIND_SIZE } from "./layout";
import { tag } from "./objects";

const CJK_END_RE = /[\u3400-\u9fff\uf900-\ufaff，、；：（《「『【]$/;
const CJK_START_RE = /^[\u3400-\u9fff\uf900-\ufaff）》」』】]/;
const SENTENCE_END_RE = /[。！？!?：:；;……”—」』"'.]$/;
const STRUCTURAL_LINE_RE = /^\s*(?:#{1,6}\s|[-*+•]\s|\d+[.)、]\s|>\s|\|)/;

export function cleanPdfText(raw: string): { text: string; changed: boolean } {
  const normalized = raw.replace(/\r\n?/g, "\n");
  if (!normalized.includes("\n")) return { text: normalized, changed: false };
  // Never touch fenced code blocks or markdown tables
  if (normalized.includes("```") || /\n\|?[-:\s]+\|[-:\s|]+\n/.test(normalized)) {
    return { text: normalized, changed: false };
  }

  const lines = normalized.split("\n");
  const out: string[] = [];
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Preserve blank lines (real paragraph boundaries)
    if (!trimmed) {
      out.push("");
      continue;
    }

    if (out.length === 0 || out[out.length - 1] === "") {
      out.push(trimmed);
      continue;
    }

    const prev = out[out.length - 1];
    const prevIsStructural = STRUCTURAL_LINE_RE.test(prev);
    const curIsStructural = STRUCTURAL_LINE_RE.test(trimmed);
    const prevEndedSentence = SENTENCE_END_RE.test(prev);

    // Join if previous line did NOT finish a sentence and neither line is a heading/list
    if (!prevIsStructural && !curIsStructural && !prevEndedSentence) {
      if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(trimmed)) {
        out[out.length - 1] = prev.slice(0, -1) + trimmed;
      } else if (CJK_END_RE.test(prev) || CJK_START_RE.test(trimmed)) {
        out[out.length - 1] = prev + trimmed;
      } else {
        out[out.length - 1] = `${prev} ${trimmed}`;
      }
      changed = true;
    } else {
      out.push(trimmed);
    }
  }

  const result = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return { text: result, changed: changed || result !== normalized };
}

export class PdfPasteController {
  private hookedDocs = new WeakSet<Document>();

  constructor(private chrome: Chrome) {}

  /** Hook an editing card iframe so pasting PDF text inside a card cleans broken line-wraps. */
  hookEditorDoc(doc: Document): void {
    if (this.hookedDocs.has(doc)) return;
    this.hookedDocs.add(doc);
    doc.addEventListener(
      "paste",
      (evt: ClipboardEvent) => {
        const cd = evt.clipboardData;
        if (!cd || cd.files.length > 0) return;
        const raw = cd.getData("text/plain");
        if (!raw) return;
        const { text, changed } = cleanPdfText(raw);
        if (!changed) return;

        const target = evt.target instanceof Element ? evt.target : doc.activeElement;
        const cmContent = target?.closest?.(".cm-content") ?? doc.querySelector(".cm-content");
        if (!(cmContent instanceof HTMLElement)) return;
        let view: EditorView | null = null;
        try {
          view = EditorView.findFromDOM(cmContent);
        } catch {
          return;
        }
        if (!view) return;

        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: "input.paste",
        });
      },
      true
    );
  }

  /**
   * Handle paste on the Canvas itself (when not editing a card or typing in an input).
   * Cleans PDF hard-wraps and creates a Note Card at viewport center.
   */
  onCanvasPaste(evt: ClipboardEvent, canvas: CanvasLike, isTypingNow: boolean): boolean {
    if (isTypingNow) return false;
    const target = evt.target as Element | null;
    if (target && isInsideCanvasUi(target)) return false;

    const cd = evt.clipboardData;
    if (!cd || cd.files.length > 0) return false;
    // Never intercept native Obsidian Canvas node/edge copy-paste
    const types = Array.from(cd.types ?? []);
    if (types.some((t) => t.includes("obsidian") || t.includes("canvas"))) return false;

    const raw = cd.getData("text/plain");
    if (!raw || !raw.trim()) return false;
    const trimmed = raw.trim();
    if (trimmed.startsWith('{"nodes":') || trimmed.startsWith('{"edges":')) return false;

    const { text, changed } = cleanPdfText(raw);
    if (!changed) return false;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    const lineEstimate = Math.ceil(text.length / 26) + (text.match(/\n/g)?.length ?? 0);
    const size = {
      width: KIND_SIZE.note.width,
      height: Math.max(KIND_SIZE.note.height, Math.min(440, 80 + lineEstimate * 24)),
    };
    const pos = viewportCenter(canvas, size);
    const node = canvas.createTextNode({
      pos,
      size,
      text,
      focus: false,
      save: true,
    });
    if (!node) return false;
    tag(canvas, node, "note");
    commit(canvas);
    this.chrome.invalidate(canvas);
    canvas.selectOnly(node);
    return true;
  }
}
