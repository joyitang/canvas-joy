/**
 * connect.ts — the real object-to-object connection tool (PRD CON-01/02).
 *
 * Gesture: click the source object, then click the target. PRD §4.3 lists the
 * gesture itself as undecided, so this is a documented proposal, not a
 * confirmed user decision. Press Escape or pick Select to leave the mode.
 */

import type { Plugin } from "obsidian";
import {
  CanvasLike,
  NodeLike,
  autoSides,
  createEdge,
  isInsideCanvasUi,
  nodeFromEvent,
} from "./bridge";
import { computeAlignedOffsets } from "./anchors";

export class ConnectTool {
  private canvas: CanvasLike | null = null;
  private from: NodeLike | null = null;

  constructor(private plugin: Plugin) {
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt: PointerEvent) => this.onPointerDown(evt),
      true
    );
  }

  get active(): boolean {
    return !!this.canvas;
  }

  enter(canvas: CanvasLike): void {
    this.exit();
    this.canvas = canvas;
    canvas.wrapperEl.classList.add("jce-connecting");
  }

  exit(): void {
    this.clearFrom();
    this.canvas?.wrapperEl.classList.remove("jce-connecting");
    this.canvas = null;
  }

  private onPointerDown(evt: PointerEvent): void {
    if (!this.canvas) return;
    if (evt.button !== 0) return;
    if (isInsideCanvasUi(evt.target as Element)) return;

    const node = nodeFromEvent(this.canvas, evt);
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation?.();

    if (!node) {
      this.clearFrom();
      return;
    }

    if (!this.from) {
      this.from = node;
      node.nodeEl.classList.add("jce-connect-from");
      return;
    }

    if (this.from.id === node.id) {
      this.clearFrom();
      return;
    }

    const sides = autoSides(this.from, node);
    const offsets = computeAlignedOffsets(this.from, sides.from, node, sides.to);
    createEdge(this.canvas, this.from, node, sides, offsets);
    this.clearFrom();
  }

  private clearFrom(): void {
    this.from?.nodeEl.classList.remove("jce-connect-from");
    this.from = null;
  }
}
