/**
 * anchors.ts — free-sliding per-edge anchor offsets & smart alignment.
 *
 * Obsidian's native Canvas pins every edge endpoint to the 50% midpoint of one
 * of the four sides (`top` / `right` / `bottom` / `left`). On tall timeline
 * cards, multiple incoming edges pile onto the exact same midpoint.
 *
 * This module stores optional pixel offsets from the top (for left/right sides)
 * or left (for top/bottom sides) directly in the edge's `unknownData`
 * (`jceFromOffset` / `jceToOffset`), so they persist in standard `.canvas`
 * files and degrade cleanly to midpoints if the plugin is disabled.
 *
 * Because pixel offsets are measured from the top/left edge, appending new
 * timeline items to the bottom of a card keeps existing arrows locked to their
 * lines without drifting.
 */

import type { Plugin } from "obsidian";
import {
  BBox,
  CanvasLike,
  EdgeLike,
  NodeLike,
  Point,
  Rect,
  Side,
  autoSides,
} from "./bridge";

export const FROM_OFFSET = "jceFromOffset";
export const TO_OFFSET = "jceToOffset";

/** Keep arrows slightly inset from rounded card corners. */
export const EDGE_MARGIN = 16;
/** Snap back to exact midpoint when within this many px of center. */
export const CENTER_SNAP_PX = 10;

const ARROW_ROTATION: Record<Side, string> = {
  top: "180",
  bottom: "0",
  left: "90",
  right: "270",
};
const MAX_BEZIER_CONTROL = 150;
const MIN_BEZIER_CONTROL = 70;
const EDGE_OUTSET = 7;

export type AnchorEnd = "from" | "to";

export interface BezierSpec {
  from: Point;
  to: Point;
  cp1: Point;
  cp2: Point;
  path: string;
}

// ------------------------------------------------------------ pure geometry

export function isVerticalSide(side: Side): boolean {
  return side === "left" || side === "right";
}

export function sideSpan(bbox: BBox, side: Side): number {
  return isVerticalSide(side) ? bbox.maxY - bbox.minY : bbox.maxX - bbox.minX;
}

export function clampOffset(offset: number, span: number): number {
  if (span <= 0) return 0;
  const pad = Math.min(EDGE_MARGIN, span / 2);
  return Math.max(pad, Math.min(span - pad, offset));
}

/**
 * Resolve the world-space point on `side` of `bbox`.
 * When `offset` is undefined (or non-finite), falls back to the exact 50% midpoint.
 */
export function anchorPoint(bbox: BBox, side: Side, offset?: number): Point {
  const span = sideSpan(bbox, side);
  const pos =
    typeof offset === "number" && Number.isFinite(offset)
      ? clampOffset(offset, span)
      : span / 2;

  switch (side) {
    case "left":
      return { x: bbox.minX, y: bbox.minY + pos };
    case "right":
      return { x: bbox.maxX, y: bbox.minY + pos };
    case "top":
      return { x: bbox.minX + pos, y: bbox.minY };
    case "bottom":
      return { x: bbox.minX + pos, y: bbox.maxY };
  }
}

export function pushOut(pt: Point, side: Side, dist = EDGE_OUTSET): Point {
  switch (side) {
    case "top":
      return { x: pt.x, y: pt.y - dist };
    case "bottom":
      return { x: pt.x, y: pt.y + dist };
    case "left":
      return { x: pt.x - dist, y: pt.y };
    case "right":
      return { x: pt.x + dist, y: pt.y };
  }
}

export function buildBezierPath(
  fromPt: Point,
  fromSide: Side,
  toPt: Point,
  toSide: Side
): BezierSpec {
  const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
  const ctrl = Math.max(MIN_BEZIER_CONTROL, Math.min(MAX_BEZIER_CONTROL, dist / 2));
  const cp1 = pushOut(fromPt, fromSide, ctrl);
  const cp2 = pushOut(toPt, toSide, ctrl);
  return {
    from: fromPt,
    to: toPt,
    cp1,
    cp2,
    path: `M${fromPt.x},${fromPt.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${toPt.x},${toPt.y}`,
  };
}

/**
 * Given a world point `pos` and a node's `bbox`, find the closest point on
 * any of the four border segments (not just midpoints like Obsidian's native FL).
 */
export function nearestSideAndOffset(
  bbox: BBox,
  pos: Point,
  opts?: { snapCenter?: boolean; preferredSide?: Side }
): { side: Side; offset: number | undefined; snappedToCenter: boolean; dist: number; point: Point } {
  const snapCenter = opts?.snapCenter ?? true;
  const sides: Side[] = ["left", "right", "top", "bottom"];
  let bestSide: Side = opts?.preferredSide ?? "left";
  let bestDist = Infinity;
  let bestRawOffset = 0;

  for (const side of sides) {
    const span = sideSpan(bbox, side);
    const raw = isVerticalSide(side) ? pos.y - bbox.minY : pos.x - bbox.minX;
    const clamped = clampOffset(raw, span);
    const pt = anchorPoint(bbox, side, clamped);
    const d = Math.hypot(pos.x - pt.x, pos.y - pt.y);
    if (d < bestDist) {
      bestDist = d;
      bestSide = side;
      bestRawOffset = clamped;
    }
  }

  const span = sideSpan(bbox, bestSide);
  const center = span / 2;
  const snappedToCenter = snapCenter && Math.abs(bestRawOffset - center) <= CENTER_SNAP_PX;
  const offset = snappedToCenter ? undefined : Math.round(bestRawOffset);
  const point = anchorPoint(bbox, bestSide, offset);

  return { side: bestSide, offset, snappedToCenter, dist: bestDist, point };
}

/**
 * Project `pos` onto a specific `side` of `bbox`.
 */
export function offsetOnSide(
  bbox: BBox,
  side: Side,
  pos: Point,
  snapCenter = true
): { offset: number | undefined; snappedToCenter: boolean; point: Point } {
  const span = sideSpan(bbox, side);
  const raw = isVerticalSide(side) ? pos.y - bbox.minY : pos.x - bbox.minX;
  const clamped = clampOffset(raw, span);
  const snappedToCenter = snapCenter && Math.abs(clamped - span / 2) <= CENTER_SNAP_PX;
  const offset = snappedToCenter ? undefined : Math.round(clamped);
  return { offset, snappedToCenter, point: anchorPoint(bbox, side, offset) };
}

/**
 * Default smart alignment for connecting two cards:
 * If a smaller card connects horizontally to a taller card (or vertically to a
 * wider card), align the anchor on the larger card with the smaller card's
 * center so the arrow runs straight instead of bending to the midpoint.
 */
export function computeAlignedOffsets(
  from: Rect,
  fromSide: Side,
  to: Rect,
  toSide: Side
): { fromOffset?: number; toOffset?: number } {
  const horizontal = isVerticalSide(fromSide) && isVerticalSide(toSide);
  const vertical = !isVerticalSide(fromSide) && !isVerticalSide(toSide);
  if (!horizontal && !vertical) return {};

  if (horizontal) {
    const fromCenterY = from.y + from.height / 2;
    const toCenterY = to.y + to.height / 2;
    if (Math.abs(fromCenterY - toCenterY) <= CENTER_SNAP_PX) return {};

    // Prefer moving the anchor on the taller card (the timeline / detail card).
    if (to.height >= from.height) {
      const target = fromCenterY - to.y;
      const clamped = clampOffset(target, to.height);
      if (Math.abs(clamped - to.height / 2) > CENTER_SNAP_PX) {
        return { toOffset: Math.round(clamped) };
      }
    } else {
      const target = toCenterY - from.y;
      const clamped = clampOffset(target, from.height);
      if (Math.abs(clamped - from.height / 2) > CENTER_SNAP_PX) {
        return { fromOffset: Math.round(clamped) };
      }
    }
    return {};
  }

  // Vertical connection (top/bottom)
  const fromCenterX = from.x + from.width / 2;
  const toCenterX = to.x + to.width / 2;
  if (Math.abs(fromCenterX - toCenterX) <= CENTER_SNAP_PX) return {};

  if (to.width >= from.width) {
    const target = fromCenterX - to.x;
    const clamped = clampOffset(target, to.width);
    if (Math.abs(clamped - to.width / 2) > CENTER_SNAP_PX) {
      return { toOffset: Math.round(clamped) };
    }
  } else {
    const target = toCenterX - from.x;
    const clamped = clampOffset(target, from.width);
    if (Math.abs(clamped - from.width / 2) > CENTER_SNAP_PX) {
      return { fromOffset: Math.round(clamped) };
    }
  }
  return {};
}

// ------------------------------------------------------- edge data helpers

export function edgeOffsetOf(edge: EdgeLike, end: AnchorEnd): number | undefined {
  const key = end === "from" ? FROM_OFFSET : TO_OFFSET;
  const val = edge.unknownData?.[key];
  return typeof val === "number" && Number.isFinite(val) ? val : undefined;
}

export function setEdgeOffset(
  edge: EdgeLike,
  end: AnchorEnd,
  offset: number | undefined
): void {
  const key = end === "from" ? FROM_OFFSET : TO_OFFSET;
  if (!edge.unknownData) edge.unknownData = {};
  if (typeof offset === "number" && Number.isFinite(offset)) {
    edge.unknownData[key] = Math.round(offset);
  } else {
    delete edge.unknownData[key];
  }
}

function bboxOf(node: NodeLike): BBox {
  if (typeof node.getBBox === "function") return node.getBBox();
  return {
    minX: node.x,
    minY: node.y,
    maxX: node.x + node.width,
    maxY: node.y + node.height,
  };
}

function isRealNode(node: NodeLike | undefined): node is NodeLike {
  return !!node && node.width > 0 && node.height > 0;
}

// ---------------------------------------------------- runtime controller

type EdgeProto = {
  updatePath: (this: EdgeLike) => void;
  getBBox: (this: EdgeLike) => BBox;
  update: (this: EdgeLike, from: EdgeLike["from"], to: EdgeLike["to"]) => void;
};

interface HandlePair {
  from: HTMLDivElement;
  to: HTMLDivElement;
  edge: EdgeLike | null;
}

interface HandleDragState {
  canvas: CanvasLike;
  edge: EdgeLike;
  end: AnchorEnd;
  origFrom: EdgeLike["from"];
  origTo: EdgeLike["to"];
  origFromOffset: number | undefined;
  origToOffset: number | undefined;
  moved: boolean;
}

export class EdgeAnchorsController {
  private patchedProto: EdgeProto | null = null;
  private origUpdatePath: EdgeProto["updatePath"] | null = null;
  private origGetBBox: EdgeProto["getBBox"] | null = null;
  private origUpdate: EdgeProto["update"] | null = null;

  private patchedCanvases = new Map<CanvasLike, CanvasLike["addEdge"]>();
  private canvasHandles = new WeakMap<CanvasLike, HandlePair>();
  private previewDots = new WeakMap<CanvasLike, HTMLElement>();

  private lastPointerEvt: PointerEvent | null = null;
  private activeDrag: HandleDragState | null = null;
  private internalUpdating = false;

  constructor(private plugin: Plugin) {
    this.plugin.registerDomEvent(
      document,
      "pointermove",
      (evt: PointerEvent) => {
        this.lastPointerEvt = evt;
        if (this.activeDrag) this.onHandleMove(evt);
      },
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointerup",
      (evt: PointerEvent) => {
        if (this.activeDrag) this.onHandleUp(evt);
        this.hideAllPreviewDots();
        window.requestAnimationFrame(() => this.syncAllHandles());
      },
      true
    );
    this.plugin.registerDomEvent(
      document,
      "click",
      () => {
        window.requestAnimationFrame(() => this.syncAllHandles());
      },
      true
    );
    this.plugin.registerDomEvent(
      window,
      "keydown",
      (evt: KeyboardEvent) => {
        if (evt.key === "Escape" && this.activeDrag) {
          evt.preventDefault();
          evt.stopPropagation();
          this.cancelHandleDrag();
        }
      },
      true
    );
  }

  attach(canvas: CanvasLike): void {
    // Patch Edge.prototype from any existing edge right away.
    for (const edge of canvas.edges.values()) {
      this.ensureProtoPatched(edge);
      break;
    }

    // Also wrap canvas.addEdge so the very first edge added to an empty canvas
    // patches Edge.prototype immediately before its first render.
    if (!this.patchedCanvases.has(canvas)) {
      const origAddEdge = canvas.addEdge.bind(canvas);
      this.patchedCanvases.set(canvas, origAddEdge);
      canvas.addEdge = (edge: EdgeLike) => {
        this.ensureProtoPatched(edge);
        origAddEdge(edge);
      };
    }

    // Re-render any edges that already carry saved custom offsets.
    for (const edge of canvas.edges.values()) {
      if (
        edgeOffsetOf(edge, "from") !== undefined ||
        edgeOffsetOf(edge, "to") !== undefined
      ) {
        edge.updatePath?.();
      }
    }
  }

  detach(canvas: CanvasLike): void {
    const origAddEdge = this.patchedCanvases.get(canvas);
    if (origAddEdge) {
      canvas.addEdge = origAddEdge;
      this.patchedCanvases.delete(canvas);
    }
    this.previewDots.get(canvas)?.remove();
    this.previewDots.delete(canvas);
    const pair = this.canvasHandles.get(canvas);
    if (pair) {
      pair.from.remove();
      pair.to.remove();
      this.canvasHandles.delete(canvas);
    }
  }

  destroy(): void {
    if (this.activeDrag) this.cancelHandleDrag();
    for (const canvas of Array.from(this.patchedCanvases.keys())) {
      this.detach(canvas);
    }
    if (this.patchedProto) {
      if (this.origUpdatePath) this.patchedProto.updatePath = this.origUpdatePath;
      if (this.origGetBBox) this.patchedProto.getBBox = this.origGetBBox;
      if (this.origUpdate) this.patchedProto.update = this.origUpdate;
      this.patchedProto = null;
      this.origUpdatePath = null;
      this.origGetBBox = null;
      this.origUpdate = null;
    }
    // Remove any injected handle elements from the DOM.
    document.querySelectorAll(".jce-edge-handle").forEach((el) => el.remove());
    document.querySelectorAll(".jce-anchor-dot").forEach((el) => el.remove());
  }

  // ------------------------------------------------------- prototype patch

  private ensureProtoPatched(edge: EdgeLike): void {
    if (this.patchedProto) return;
    const proto = Object.getPrototypeOf(edge) as EdgeProto | null;
    if (!proto || typeof proto.updatePath !== "function") return;

    this.patchedProto = proto;
    this.origUpdatePath = proto.updatePath;
    this.origGetBBox = proto.getBBox;
    this.origUpdate = proto.update;

    const onUpdatePath = (e: EdgeLike): void => this.patchedUpdatePath(e);
    const onGetBBox = (e: EdgeLike): BBox => this.patchedGetBBox(e);
    const onUpdate = (e: EdgeLike, from: EdgeLike["from"], to: EdgeLike["to"]): void =>
      this.patchedUpdate(e, from, to);

    proto.updatePath = function (this: EdgeLike) {
      onUpdatePath(this);
    };

    proto.getBBox = function (this: EdgeLike): BBox {
      return onGetBBox(this);
    };

    proto.update = function (this: EdgeLike, from: EdgeLike["from"], to: EdgeLike["to"]) {
      onUpdate(this, from, to);
    };
  }

  private patchedGetBBox(edge: EdgeLike): BBox {
    const fromPt = anchorPoint(
      bboxOf(edge.from.node),
      edge.from.side,
      edgeOffsetOf(edge, "from")
    );
    const toPt = anchorPoint(
      bboxOf(edge.to.node),
      edge.to.side,
      edgeOffsetOf(edge, "to")
    );
    return {
      minX: Math.min(fromPt.x, toPt.x),
      minY: Math.min(fromPt.y, toPt.y),
      maxX: Math.max(fromPt.x, toPt.x),
      maxY: Math.max(fromPt.y, toPt.y),
    };
  }

  private patchedUpdatePath(edge: EdgeLike): void {
    const path = edge.path;
    if (!path?.interaction || !path?.display) {
      if (path) this.origUpdatePath?.call(edge);
      return;
    }

    const { from, to } = edge;
    const fromOffset = edgeOffsetOf(edge, "from");
    const toOffset = edgeOffsetOf(edge, "to");

    const a = anchorPoint(bboxOf(from.node), from.side, fromOffset);
    const s = pushOut(a, from.side, EDGE_OUTSET);
    const l = anchorPoint(bboxOf(to.node), to.side, toOffset);
    const c = pushOut(l, to.side, EDGE_OUTSET);
    const bezier = buildBezierPath(s, from.side, c, to.side);
    edge.bezier = bezier;

    let fromEnd = edge.fromLineEnd;
    if (from.end !== fromEnd?.type) {
      fromEnd?.el?.remove();
      fromEnd = edge.fromLineEnd = edge.createEdgeEnd?.(from.end) ?? null;
    }

    let toEnd = edge.toLineEnd;
    if (to.end !== toEnd?.type) {
      toEnd?.el?.remove();
      toEnd = edge.toLineEnd = edge.createEdgeEnd?.(to.end) ?? null;
    }

    let d = bezier.path;
    if (fromEnd) {
      fromEnd.el.style.transform = `translate(${a.x}px, ${a.y}px) rotate(${ARROW_ROTATION[from.side]}deg)`;
    } else {
      d = `M${a.x} ${a.y} L${s.x} ${s.y} ${d}`;
    }

    if (toEnd) {
      toEnd.el.style.transform = `translate(${l.x}px, ${l.y}px) rotate(${ARROW_ROTATION[to.side]}deg)`;
    } else {
      d = `${d} M${c.x} ${c.y} L${l.x} ${l.y}`;
    }

    path.interaction.setAttribute("d", d);
    path.display.setAttribute("d", d);

    if (edge.canvas) this.syncHandles(edge.canvas);
  }

  /**
   * Intercept native `edge.update(from, to)` during native drag-to-connect
   * (`canvas.canvasEl.is-connecting`) so dragging from a card's native dot or
   * dragging an existing edge snaps smoothly anywhere along the target card's
   * four edges — and aligns cleanly with the source card when dropped inside.
   */
  private patchedUpdate(
    edge: EdgeLike,
    from: EdgeLike["from"],
    to: EdgeLike["to"]
  ): void {
    const canvas = edge.canvas;
    if (
      this.internalUpdating ||
      !canvas ||
      !canvas.canvasEl?.classList.contains("is-connecting") ||
      !this.lastPointerEvt
    ) {
      this.origUpdate?.call(edge, from, to);
      return;
    }

    const pos = canvas.posFromEvt(this.lastPointerEvt);
    const snapCenter = !this.lastPointerEvt.altKey;

    // Determine which end is actively being dragged:
    // If `to.node` changed (or is a virtual 0x0 drag node) while `from.node` stayed,
    // the user is dragging the `to` end; vice versa for `from`.
    const fromIsVirtual = !isRealNode(from.node);
    const toIsVirtual = !isRealNode(to.node);

    let nextFrom = from;
    let nextTo = to;

    if (toIsVirtual) {
      setEdgeOffset(edge, "to", undefined);
      this.hidePreviewDot(canvas);
    } else if (fromIsVirtual) {
      setEdgeOffset(edge, "from", undefined);
      this.hidePreviewDot(canvas);
    } else {
      // Both ends are real nodes during `is-connecting`: figure out which end
      // is closer to the pointer (the end being moved).
      const dFrom = Math.hypot(
        pos.x - (from.node.x + from.node.width / 2),
        pos.y - (from.node.y + from.node.height / 2)
      );
      const dTo = Math.hypot(
        pos.x - (to.node.x + to.node.width / 2),
        pos.y - (to.node.y + to.node.height / 2)
      );
      const movingEnd: AnchorEnd =
        from.node !== edge.from.node
          ? "from"
          : to.node !== edge.to.node
            ? "to"
            : dFrom < dTo
              ? "from"
              : "to";

      if (movingEnd === "to") {
        const bbox = bboxOf(to.node);
        const snap = this.resolveTargetSnap(from.node, from.side, edgeOffsetOf(edge, "from"), bbox, pos, snapCenter);
        nextTo = { ...to, side: snap.side };
        setEdgeOffset(edge, "to", snap.offset);
        this.showPreviewDot(canvas, snap.point, snap.snappedToCenter);
      } else {
        const bbox = bboxOf(from.node);
        const snap = this.resolveTargetSnap(to.node, to.side, edgeOffsetOf(edge, "to"), bbox, pos, snapCenter);
        nextFrom = { ...from, side: snap.side };
        setEdgeOffset(edge, "from", snap.offset);
        this.showPreviewDot(canvas, snap.point, snap.snappedToCenter);
      }
    }

    this.origUpdate?.call(edge, nextFrom, nextTo);
  }

  /**
   * Compute target side & offset when hovering a target card during native drag:
   * - Near the card border (within 40px of an edge): snap freely to the exact
   *   border position under the cursor (so the user can aim at any timeline line).
   * - Deep inside the card body (>40px from all borders): pick the natural facing
   *   side and align horizontally/vertically with the cursor (or opposite anchor
   *   if the cursor is near the card's vertical/horizontal center).
   */
  private resolveTargetSnap(
    otherNode: NodeLike,
    otherSide: Side,
    otherOffset: number | undefined,
    targetBBox: BBox,
    pos: Point,
    snapCenter: boolean
  ): { side: Side; offset: number | undefined; snappedToCenter: boolean; point: Point } {
    const nearest = nearestSideAndOffset(targetBBox, pos, { snapCenter });
    const insideX = pos.x >= targetBBox.minX && pos.x <= targetBBox.maxX;
    const insideY = pos.y >= targetBBox.minY && pos.y <= targetBBox.maxY;

    if (insideX && insideY && nearest.dist > 40) {
      // Deep inside the card: choose the side facing the other node, and align
      // straight with the other anchor (or cursor along that axis).
      const targetRect: Rect = {
        x: targetBBox.minX,
        y: targetBBox.minY,
        width: targetBBox.maxX - targetBBox.minX,
        height: targetBBox.maxY - targetBBox.minY,
      };
      const otherRect: Rect = {
        x: otherNode.x,
        y: otherNode.y,
        width: otherNode.width,
        height: otherNode.height,
      };
      const side = autoSides(targetRect, otherRect).from;
      const otherAnchor = anchorPoint(bboxOf(otherNode), otherSide, otherOffset);
      const aligned = offsetOnSide(targetBBox, side, otherAnchor, snapCenter);
      return { side, ...aligned };
    }

    return {
      side: nearest.side,
      offset: nearest.offset,
      snappedToCenter: nearest.snappedToCenter,
      point: nearest.point,
    };
  }

  // ------------------------------------------------ focused endpoint handles

  syncHandles(canvas: CanvasLike): void {
    const focused = this.focusedEdgeOf(canvas);
    if (!focused) {
      const pair = this.canvasHandles.get(canvas);
      if (pair) {
        pair.edge = null;
        pair.from.hidden = true;
        pair.to.hidden = true;
      }
      return;
    }

    const pair = this.ensureHandlePair(canvas);
    pair.edge = focused;
    const fromPt = anchorPoint(
      bboxOf(focused.from.node),
      focused.from.side,
      edgeOffsetOf(focused, "from")
    );
    const toPt = anchorPoint(
      bboxOf(focused.to.node),
      focused.to.side,
      edgeOffsetOf(focused, "to")
    );
    pair.from.setCssStyles({ transform: `translate(${fromPt.x}px, ${fromPt.y}px)` });
    pair.to.setCssStyles({ transform: `translate(${toPt.x}px, ${toPt.y}px)` });
    pair.from.hidden = false;
    pair.to.hidden = false;
  }

  private syncAllHandles(): void {
    for (const canvas of this.patchedCanvases.keys()) {
      this.syncHandles(canvas);
    }
  }

  private focusedEdgeOf(canvas: CanvasLike): EdgeLike | null {
    if (this.activeDrag && this.activeDrag.canvas === canvas) {
      return this.activeDrag.edge;
    }
    const sel = canvas.selection;
    if (sel && sel.size === 1) {
      const only = sel.values().next().value as unknown;
      if (only && typeof only === "object" && "from" in only && "to" in only) {
        return only as EdgeLike;
      }
    }
    for (const edge of canvas.edges.values()) {
      if (edge.lineEndGroupEl?.classList.contains("is-focused")) {
        return edge;
      }
    }
    return null;
  }

  private ensureHandlePair(canvas: CanvasLike): HandlePair {
    let pair = this.canvasHandles.get(canvas);
    if (pair && canvas.canvasEl.contains(pair.from) && canvas.canvasEl.contains(pair.to)) {
      return pair;
    }
    const from = this.makeHandle(canvas, "from");
    const to = this.makeHandle(canvas, "to");
    canvas.canvasEl.appendChild(from);
    canvas.canvasEl.appendChild(to);
    pair = { from, to, edge: null };
    this.canvasHandles.set(canvas, pair);
    return pair;
  }

  private makeHandle(canvas: CanvasLike, end: AnchorEnd): HTMLDivElement {
    const el = createDiv();
    el.className = "jce-edge-handle";
    el.dataset.end = end;
    el.hidden = true;

    el.addEventListener("pointerdown", (evt: PointerEvent) => {
      if (evt.button !== 0) return;
      const pair = this.canvasHandles.get(canvas);
      const edge = pair?.edge;
      if (!edge) return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation?.();

      canvas.pushHistory?.(canvas.getData());
      this.activeDrag = {
        canvas,
        edge,
        end,
        origFrom: { ...edge.from },
        origTo: { ...edge.to },
        origFromOffset: edgeOffsetOf(edge, "from"),
        origToOffset: edgeOffsetOf(edge, "to"),
        moved: false,
      };
      canvas.wrapperEl.classList.add("jce-anchor-dragging");
    });

    el.addEventListener("dblclick", (evt: MouseEvent) => {
      const pair = this.canvasHandles.get(canvas);
      const edge = pair?.edge;
      if (!edge) return;
      evt.preventDefault();
      evt.stopPropagation();
      canvas.pushHistory?.(canvas.getData());
      setEdgeOffset(edge, end, undefined);
      edge.updatePath?.();
      canvas.markMoved?.(edge);
      canvas.requestSave();
      canvas.requestFrame();
    });

    return el;
  }

  private onHandleMove(evt: PointerEvent): void {
    const drag = this.activeDrag;
    if (!drag) return;
    const { canvas, edge, end } = drag;
    const pos = canvas.posFromEvt(evt);
    const snapCenter = !evt.altKey;
    const fixedNode = end === "from" ? edge.to.node : edge.from.node;

    // Pick the card under/near the pointer; default to the current attached card
    // so dragging slightly outside the border still slides smoothly along it.
    const currentNode = end === "from" ? edge.from.node : edge.to.node;
    const targetNode = this.findNodeNear(canvas, pos, fixedNode, currentNode);
    const snap = nearestSideAndOffset(bboxOf(targetNode), pos, { snapCenter });

    drag.moved = true;
    setEdgeOffset(edge, end, snap.offset);

    const nextFrom =
      end === "from"
        ? { node: targetNode, side: snap.side, end: edge.from.end }
        : edge.from;
    const nextTo =
      end === "to"
        ? { node: targetNode, side: snap.side, end: edge.to.end }
        : edge.to;

    this.internalUpdating = true;
    try {
      edge.update?.(nextFrom, nextTo);
      edge.updatePath?.();
    } finally {
      this.internalUpdating = false;
    }

    this.showPreviewDot(canvas, snap.point, snap.snappedToCenter);
    canvas.requestFrame();
  }

  private onHandleUp(_evt: PointerEvent): void {
    const drag = this.activeDrag;
    if (!drag) return;
    this.activeDrag = null;
    drag.canvas.wrapperEl.classList.remove("jce-anchor-dragging");
    this.hidePreviewDot(drag.canvas);
    if (drag.moved) {
      drag.canvas.requestSave();
      drag.canvas.requestFrame();
    }
  }

  private cancelHandleDrag(): void {
    const drag = this.activeDrag;
    if (!drag) return;
    this.activeDrag = null;
    drag.canvas.wrapperEl.classList.remove("jce-anchor-dragging");
    this.hidePreviewDot(drag.canvas);
    setEdgeOffset(drag.edge, "from", drag.origFromOffset);
    setEdgeOffset(drag.edge, "to", drag.origToOffset);
    this.internalUpdating = true;
    try {
      drag.edge.update?.(drag.origFrom, drag.origTo);
      drag.edge.updatePath?.();
    } finally {
      this.internalUpdating = false;
    }
    drag.canvas.requestFrame();
  }

  private findNodeNear(
    canvas: CanvasLike,
    pos: Point,
    exclude: NodeLike,
    fallback: NodeLike
  ): NodeLike {
    const snapDist = 28;
    // If still within snapDist of the currently attached card, prefer staying on it
    // unless the pointer clearly moved inside another non-group card.
    let best: NodeLike | null = null;
    let bestDist = Infinity;

    for (const node of canvas.nodes.values()) {
      if (node === exclude || !isRealNode(node)) continue;
      const b = bboxOf(node);
      const inside =
        pos.x >= b.minX - snapDist &&
        pos.x <= b.maxX + snapDist &&
        pos.y >= b.minY - snapDist &&
        pos.y <= b.maxY + snapDist;
      if (!inside) continue;

      const d = nearestSideAndOffset(b, pos, { snapCenter: false }).dist;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best ?? fallback;
  }

  // ------------------------------------------------------ visual snap dot

  private showPreviewDot(canvas: CanvasLike, pt: Point, centered: boolean): void {
    let dot = this.previewDots.get(canvas);
    if (!dot || !canvas.canvasEl.contains(dot)) {
      dot = createDiv();
      dot.className = "jce-anchor-dot";
      canvas.canvasEl.appendChild(dot);
      this.previewDots.set(canvas, dot);
    }
    dot.setCssStyles({ transform: `translate(${pt.x}px, ${pt.y}px)` });
    dot.classList.toggle("is-centered", centered);
    dot.hidden = false;
  }

  private hidePreviewDot(canvas: CanvasLike): void {
    const dot = this.previewDots.get(canvas);
    if (dot) dot.hidden = true;
  }

  private hideAllPreviewDots(): void {
    for (const canvas of this.patchedCanvases.keys()) {
      this.hidePreviewDot(canvas);
    }
  }
}
