"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  TOOLS: () => TOOLS,
  default: () => CanvasEnhancePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian10 = require("obsidian");

// src/bridge.ts
var edgeCtors = /* @__PURE__ */ new WeakMap();
function uid() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function allNodes(canvas) {
  return Array.from(canvas.nodes.values());
}
function allEdges(canvas) {
  return Array.from(canvas.edges.values());
}
function scaleOf(canvas) {
  if (typeof canvas.scale === "number" && Number.isFinite(canvas.scale) && canvas.scale > 0) {
    return canvas.scale;
  }
  const z = canvas.zoom ?? canvas.tZoom;
  if (typeof z === "number" && Number.isFinite(z)) {
    return Math.pow(2, z);
  }
  return 1;
}
function focusNodeInViewport(canvas, node) {
  const pad = Math.max(120, Math.min(node.width, node.height) * 0.6);
  const bbox = {
    minX: node.x - pad,
    minY: node.y - pad,
    maxX: node.x + node.width + pad,
    maxY: node.y + node.height + pad
  };
  if (typeof canvas.zoomToBbox === "function") {
    canvas.zoomToBbox(bbox);
    return;
  }
  canvas.tx = node.x + node.width / 2;
  canvas.ty = node.y + node.height / 2;
  canvas.markViewportChanged?.();
  canvas.requestFrame();
}
function isEditing(node) {
  if (node.isEditing) return true;
  return !!node.nodeEl?.classList.contains("is-editing");
}
function viewportCenter(canvas, size) {
  const box = canvas.getViewportBBox();
  return {
    x: Math.round((box.minX + box.maxX) / 2 - size.width / 2),
    y: Math.round((box.minY + box.maxY) / 2 - size.height / 2)
  };
}
function nodeFromEvent(canvas, evt) {
  const target = evt instanceof Element ? evt : evt.target;
  if (!target) return null;
  const el = target.closest?.(".canvas-node");
  const scopeEl = el instanceof HTMLElement ? el : target instanceof HTMLElement ? target : null;
  if (!scopeEl) return null;
  for (const node of canvas.nodes.values()) {
    const nel = node.nodeEl;
    if (!nel) continue;
    if (nel === scopeEl || nel.contains(scopeEl) || scopeEl.contains(nel)) return node;
  }
  return null;
}
function isInsideCanvasUi(el) {
  if (!el) return false;
  return !!el.closest(
    ".jce-toolbar, .jce-format-bar, .jce-menu, .jce-search-bar, .jce-focus-pill, .jce-fold-btn, .jce-collapsed-bar, .jce-align-bar, .jce-minimap, .jce-chronos-bar, .jce-edge-handle, .menu, .modal-container, .canvas-controls, .canvas-card-menu, .canvas-menu"
  );
}
function commit(canvas) {
  canvas.requestSave();
  canvas.requestFrame();
}
function setNodeData(canvas, node, patch) {
  const next = { ...node.getData(), ...patch };
  node.setData(next);
  canvas.requestSave();
}
function edgeCtor(canvas) {
  const cached = edgeCtors.get(canvas);
  if (cached) return cached;
  const first = canvas.edges.values().next();
  if (first.done) return void 0;
  const ctor = first.value.constructor;
  edgeCtors.set(canvas, ctor);
  return ctor;
}
function findEdge(canvas, fromId, toId) {
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id === fromId && edge.to.node.id === toId) return edge;
  }
  return void 0;
}
function createEdge(canvas, from, to, sides, offsets) {
  const existing = findEdge(canvas, from.id, to.id);
  if (existing) return existing;
  const extra = {};
  if (typeof offsets?.fromOffset === "number" && Number.isFinite(offsets.fromOffset)) {
    extra.jceFromOffset = Math.round(offsets.fromOffset);
  }
  if (typeof offsets?.toOffset === "number" && Number.isFinite(offsets.toOffset)) {
    extra.jceToOffset = Math.round(offsets.toOffset);
  }
  const ctor = edgeCtor(canvas);
  if (ctor) {
    const edge = new ctor(
      canvas,
      uid(),
      { node: from, side: sides.from, end: "none" },
      { node: to, side: sides.to, end: "arrow" }
    );
    if (Object.keys(extra).length > 0) {
      edge.unknownData = { ...edge.unknownData ?? {}, ...extra };
    }
    canvas.addEdge(edge);
    canvas.markMoved?.(edge);
    edge.render?.();
    commit(canvas);
    return edge;
  }
  const data = structuredClone(canvas.getData());
  const id = uid();
  data.edges.push({
    id,
    fromNode: from.id,
    fromSide: sides.from,
    fromEnd: "none",
    toNode: to.id,
    toSide: sides.to,
    toEnd: "arrow",
    ...extra
  });
  canvas.setData(data);
  const made = canvas.edges.get(id);
  if (made) edgeCtors.set(canvas, made.constructor);
  canvas.requestFrame();
  return made;
}
function deleteNodes(canvas, ids) {
  const kill = new Set(ids);
  for (const node of Array.from(canvas.nodes.values())) {
    if (kill.has(node.id)) canvas.removeNode(node);
  }
  for (const edge of Array.from(canvas.edges.values())) {
    if (kill.has(edge.from.node.id) || kill.has(edge.to.node.id)) canvas.removeEdge(edge);
  }
  canvas.requestSave();
  canvas.requestFrame();
}
function selectedNodes(canvas) {
  return Array.from(canvas.selection ?? []).filter(
    (item) => !!item && typeof item === "object" && "nodeEl" in item && !!item.nodeEl
  );
}
function autoSides(a, b) {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  }
  return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}

// src/align.ts
var import_obsidian = require("obsidian");

// src/copy.ts
var TOOLS = {
  select: { id: "select", zh: "\u9009\u62E9", en: "Select", key: "V" },
  connect: { id: "connect", zh: "\u8FDE\u7EBF", en: "Connect", key: "C" },
  note: { id: "note", zh: "\u7B14\u8BB0\u5361", en: "Note card", key: "N" },
  text: { id: "text", zh: "\u6587\u5B57", en: "Text", key: "T" },
  todo: { id: "todo", zh: "\u5F85\u529E", en: "To-do", key: "D" },
  mindmap: { id: "mindmap", zh: "\u601D\u7EF4\u5BFC\u56FE", en: "Mindmap", key: "M" },
  section: { id: "section", zh: "\u5206\u533A", en: "Section", key: "G" }
};
var SEARCH_TOOL = { id: "search", zh: "\u641C\u7D22", en: "Search", key: "\u2318F" };
var MINIMAP_TOOL = { id: "minimap", zh: "\u5C0F\u5730\u56FE", en: "Minimap" };
var CHRONOS_TOOL = { id: "chronos", zh: "\u65F6\u95F4\u8F74", en: "Chronos" };
var ALIGN_OPS = {
  left: { zh: "\u5DE6\u5BF9\u9F50", en: "Align left" },
  centerX: { zh: "\u6C34\u5E73\u5C45\u4E2D", en: "Align horizontal centers" },
  right: { zh: "\u53F3\u5BF9\u9F50", en: "Align right" },
  top: { zh: "\u9876\u5BF9\u9F50", en: "Align top" },
  centerY: { zh: "\u5782\u76F4\u5C45\u4E2D", en: "Align vertical centers" },
  bottom: { zh: "\u5E95\u5BF9\u9F50", en: "Align bottom" },
  distX: { zh: "\u6C34\u5E73\u7B49\u8DDD\u5206\u5E03", en: "Distribute horizontally" },
  distY: { zh: "\u5782\u76F4\u7B49\u8DDD\u5206\u5E03", en: "Distribute vertically" }
};
var MENU = {
  color: { zh: "\u989C\u8272", en: "Color" },
  cardBg: { zh: "\u5361\u7247\u5E95\u8272", en: "Card background" },
  remove: { zh: "\u79FB\u9664", en: "Remove" },
  fold: { zh: "\u6298\u53E0", en: "Fold" },
  unfold: { zh: "\u5C55\u5F00", en: "Unfold" },
  rotate: { zh: "\u65CB\u8F6C", en: "Rotate" },
  focus: { zh: "\u805A\u7126", en: "Focus" },
  unfocus: { zh: "\u9000\u51FA\u805A\u7126", en: "Exit focus" },
  groupSection: { zh: "\u6253\u5305\u8FDB\u5206\u533A", en: "Group into section" },
  align: { zh: "\u5BF9\u9F50\u4E0E\u5206\u5E03", en: "Align & distribute" },
  collapseCard: { zh: "\u6298\u53E0", en: "Collapse" },
  expandCard: { zh: "\u5C55\u5F00", en: "Expand" },
  setTime: { zh: "\u6307\u5B9A\u5E74\u4EFD", en: "Set time" },
  chronosFocus: { zh: "\u65F6\u95F4\u8F74\u67E5\u770B", en: "View in Chronos" }
};
var DEFAULTS = {
  noteCard: "Note Card",
  todo: "- [ ] ",
  section: "Section",
  mindmapRoot: "Mindmap",
  text: ""
};
function tooltip(tool) {
  return tool.key ? `${tool.zh} / ${tool.en}  ${tool.key}` : `${tool.zh} / ${tool.en}`;
}
function menuLabel(item) {
  return `${item.zh} / ${item.en}`;
}

// src/align.ts
var ICON_FOR_OP = {
  left: "align-start-vertical",
  centerX: "align-center-vertical",
  right: "align-end-vertical",
  top: "align-start-horizontal",
  centerY: "align-center-horizontal",
  bottom: "align-end-horizontal",
  distX: "align-horizontal-distribute-center",
  distY: "align-vertical-distribute-center"
};
var OP_ORDER = [
  "left",
  "centerX",
  "right",
  "top",
  "centerY",
  "bottom",
  "distX",
  "distY"
];
function computeAlignMoves(items, op) {
  if (items.length < 2) return [];
  if (op === "distX" || op === "distY") {
    if (items.length < 3) return [];
    const horiz = op === "distX";
    const sorted = [...items].sort(
      (a, b) => horiz ? a.rect.x - b.rect.x || a.rect.y - b.rect.y : a.rect.y - b.rect.y || a.rect.x - b.rect.x
    );
    const first = sorted[0].rect;
    const last = sorted[sorted.length - 1].rect;
    const span = horiz ? last.x + last.width - first.x : last.y + last.height - first.y;
    const totalSize = sorted.reduce(
      (sum, it) => sum + (horiz ? it.rect.width : it.rect.height),
      0
    );
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = horiz ? first.x : first.y;
    const moves = [];
    for (const it of sorted) {
      const targetX = horiz ? Math.round(cursor) : it.rect.x;
      const targetY = horiz ? it.rect.y : Math.round(cursor);
      moves.push({ id: it.id, x: targetX, y: targetY });
      cursor += (horiz ? it.rect.width : it.rect.height) + gap;
    }
    return moves;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { rect } of items) {
    minX = Math.min(minX, rect.x);
    maxX = Math.max(maxX, rect.x + rect.width);
    minY = Math.min(minY, rect.y);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return items.map(({ id, rect }) => {
    let x = rect.x;
    let y = rect.y;
    switch (op) {
      case "left":
        x = Math.round(minX);
        break;
      case "centerX":
        x = Math.round(midX - rect.width / 2);
        break;
      case "right":
        x = Math.round(maxX - rect.width);
        break;
      case "top":
        y = Math.round(minY);
        break;
      case "centerY":
        y = Math.round(midY - rect.height / 2);
        break;
      case "bottom":
        y = Math.round(maxY - rect.height);
        break;
    }
    return { id, x, y };
  });
}
function applyAlignment(canvas, op, nodes) {
  const targets = (nodes ?? visibleSelectedNodes(canvas)).filter(
    (n) => !n.nodeEl.classList.contains("jce-sec-hidden")
  );
  const minCount = op === "distX" || op === "distY" ? 3 : 2;
  if (targets.length < minCount) return false;
  const moves = computeAlignMoves(
    targets.map((n) => ({
      id: n.id,
      rect: { x: n.x, y: n.y, width: n.width, height: n.height }
    })),
    op
  );
  if (!moves.length) return false;
  const changed = moves.some((m) => {
    const n = canvas.nodes.get(m.id);
    return n && (Math.round(n.x) !== m.x || Math.round(n.y) !== m.y);
  });
  if (!changed) return false;
  for (const m of moves) {
    const node = canvas.nodes.get(m.id);
    if (!node) continue;
    node.setData({ ...node.getData(), x: m.x, y: m.y });
    if (typeof node.moveAndResize === "function") {
      node.moveAndResize({ x: m.x, y: m.y, width: node.width, height: node.height });
    } else {
      node.x = m.x;
      node.y = m.y;
    }
    node.render?.();
  }
  commit(canvas);
  return true;
}
function visibleSelectedNodes(canvas) {
  return selectedNodes(canvas).filter(
    (n) => !n.nodeEl.classList.contains("jce-sec-hidden")
  );
}
var AlignBar = class {
  constructor(opts) {
    this.opts = opts;
    this.states = /* @__PURE__ */ new Map();
  }
  sync(canvas) {
    const sel = visibleSelectedNodes(canvas);
    const suppressed = this.opts.isSuppressed?.(canvas) === true;
    const show = !suppressed && sel.length >= 2;
    if (!show) {
      const existing = this.states.get(canvas);
      if (existing) existing.barEl.hidden = true;
      return;
    }
    const state = this.ensureState(canvas);
    if (!state) return;
    state.barEl.hidden = false;
    const canDist = sel.length >= 3;
    for (const btn of state.distBtns) {
      btn.disabled = !canDist;
      btn.toggleClass("is-disabled", !canDist);
    }
  }
  detach(canvas) {
    const state = this.states.get(canvas);
    if (!state) return;
    state.barEl.remove();
    this.states.delete(canvas);
  }
  destroy() {
    for (const canvas of Array.from(this.states.keys())) {
      this.detach(canvas);
    }
  }
  ensureState(canvas) {
    const existing = this.states.get(canvas);
    if (existing && existing.barEl.isConnected) return existing;
    existing?.barEl.remove();
    const host = canvas.wrapperEl.closest(".view-content");
    if (!host) return null;
    const barEl = host.createDiv({
      cls: "jce-align-bar",
      attr: { role: "toolbar", "aria-label": "\u5BF9\u9F50\u4E0E\u5206\u5E03 / Align & distribute" }
    });
    barEl.hidden = true;
    barEl.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    const distBtns = [];
    OP_ORDER.forEach((op, idx) => {
      if (idx === 3 || idx === 6) {
        barEl.createDiv({ cls: "jce-align-sep" });
      }
      const label = menuLabel(ALIGN_OPS[op]);
      const btn = barEl.createEl("button", {
        type: "button",
        cls: "jce-align-btn",
        attr: {
          "data-align": op,
          title: label,
          "aria-label": label
        }
      });
      (0, import_obsidian.setIcon)(btn, ICON_FOR_OP[op]);
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (btn.disabled) return;
        this.opts.onAlign(canvas, op);
      });
      if (op === "distX" || op === "distY") distBtns.push(btn);
    });
    const state = { barEl, distBtns };
    this.states.set(canvas, state);
    return state;
  }
};

// src/anchors.ts
var FROM_OFFSET = "jceFromOffset";
var TO_OFFSET = "jceToOffset";
var EDGE_MARGIN = 16;
var CENTER_SNAP_PX = 10;
var ARROW_ROTATION = {
  top: "180",
  bottom: "0",
  left: "90",
  right: "270"
};
var MAX_BEZIER_CONTROL = 150;
var MIN_BEZIER_CONTROL = 70;
var EDGE_OUTSET = 7;
function isVerticalSide(side) {
  return side === "left" || side === "right";
}
function sideSpan(bbox, side) {
  return isVerticalSide(side) ? bbox.maxY - bbox.minY : bbox.maxX - bbox.minX;
}
function clampOffset(offset, span) {
  if (span <= 0) return 0;
  const pad = Math.min(EDGE_MARGIN, span / 2);
  return Math.max(pad, Math.min(span - pad, offset));
}
function anchorPoint(bbox, side, offset) {
  const span = sideSpan(bbox, side);
  const pos = typeof offset === "number" && Number.isFinite(offset) ? clampOffset(offset, span) : span / 2;
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
function pushOut(pt, side, dist = EDGE_OUTSET) {
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
function buildBezierPath(fromPt, fromSide, toPt, toSide) {
  const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
  const ctrl = Math.max(MIN_BEZIER_CONTROL, Math.min(MAX_BEZIER_CONTROL, dist / 2));
  const cp1 = pushOut(fromPt, fromSide, ctrl);
  const cp2 = pushOut(toPt, toSide, ctrl);
  return {
    from: fromPt,
    to: toPt,
    cp1,
    cp2,
    path: `M${fromPt.x},${fromPt.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${toPt.x},${toPt.y}`
  };
}
function nearestSideAndOffset(bbox, pos, opts) {
  const snapCenter = opts?.snapCenter ?? true;
  const sides = ["left", "right", "top", "bottom"];
  let bestSide = opts?.preferredSide ?? "left";
  let bestDist = Infinity;
  let bestRawOffset = 0;
  for (const side of sides) {
    const span2 = sideSpan(bbox, side);
    const raw = isVerticalSide(side) ? pos.y - bbox.minY : pos.x - bbox.minX;
    const clamped = clampOffset(raw, span2);
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
  const offset = snappedToCenter ? void 0 : Math.round(bestRawOffset);
  const point = anchorPoint(bbox, bestSide, offset);
  return { side: bestSide, offset, snappedToCenter, dist: bestDist, point };
}
function offsetOnSide(bbox, side, pos, snapCenter = true) {
  const span = sideSpan(bbox, side);
  const raw = isVerticalSide(side) ? pos.y - bbox.minY : pos.x - bbox.minX;
  const clamped = clampOffset(raw, span);
  const snappedToCenter = snapCenter && Math.abs(clamped - span / 2) <= CENTER_SNAP_PX;
  const offset = snappedToCenter ? void 0 : Math.round(clamped);
  return { offset, snappedToCenter, point: anchorPoint(bbox, side, offset) };
}
function computeAlignedOffsets(from, fromSide, to, toSide) {
  const horizontal = isVerticalSide(fromSide) && isVerticalSide(toSide);
  const vertical2 = !isVerticalSide(fromSide) && !isVerticalSide(toSide);
  if (!horizontal && !vertical2) return {};
  if (horizontal) {
    const fromCenterY = from.y + from.height / 2;
    const toCenterY = to.y + to.height / 2;
    if (Math.abs(fromCenterY - toCenterY) <= CENTER_SNAP_PX) return {};
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
function edgeOffsetOf(edge, end) {
  const key = end === "from" ? FROM_OFFSET : TO_OFFSET;
  const val = edge.unknownData?.[key];
  return typeof val === "number" && Number.isFinite(val) ? val : void 0;
}
function setEdgeOffset(edge, end, offset) {
  const key = end === "from" ? FROM_OFFSET : TO_OFFSET;
  if (!edge.unknownData) edge.unknownData = {};
  if (typeof offset === "number" && Number.isFinite(offset)) {
    edge.unknownData[key] = Math.round(offset);
  } else {
    delete edge.unknownData[key];
  }
}
function bboxOf(node) {
  if (typeof node.getBBox === "function") return node.getBBox();
  return {
    minX: node.x,
    minY: node.y,
    maxX: node.x + node.width,
    maxY: node.y + node.height
  };
}
function isRealNode(node) {
  return !!node && node.width > 0 && node.height > 0;
}
var EdgeAnchorsController = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.patchedProto = null;
    this.origUpdatePath = null;
    this.origGetBBox = null;
    this.origUpdate = null;
    this.patchedCanvases = /* @__PURE__ */ new Map();
    this.canvasHandles = /* @__PURE__ */ new WeakMap();
    this.previewDots = /* @__PURE__ */ new WeakMap();
    this.lastPointerEvt = null;
    this.activeDrag = null;
    this.internalUpdating = false;
    this.plugin.registerDomEvent(
      document,
      "pointermove",
      (evt) => {
        this.lastPointerEvt = evt;
        if (this.activeDrag) this.onHandleMove(evt);
      },
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointerup",
      (evt) => {
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
      (evt) => {
        if (evt.key === "Escape" && this.activeDrag) {
          evt.preventDefault();
          evt.stopPropagation();
          this.cancelHandleDrag();
        }
      },
      true
    );
  }
  attach(canvas) {
    for (const edge of canvas.edges.values()) {
      this.ensureProtoPatched(edge);
      break;
    }
    if (!this.patchedCanvases.has(canvas)) {
      const origAddEdge = canvas.addEdge.bind(canvas);
      this.patchedCanvases.set(canvas, origAddEdge);
      canvas.addEdge = (edge) => {
        this.ensureProtoPatched(edge);
        origAddEdge(edge);
      };
    }
    for (const edge of canvas.edges.values()) {
      if (edgeOffsetOf(edge, "from") !== void 0 || edgeOffsetOf(edge, "to") !== void 0) {
        edge.updatePath?.();
      }
    }
  }
  detach(canvas) {
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
  destroy() {
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
    document.querySelectorAll(".jce-edge-handle").forEach((el) => el.remove());
    document.querySelectorAll(".jce-anchor-dot").forEach((el) => el.remove());
  }
  // ------------------------------------------------------- prototype patch
  ensureProtoPatched(edge) {
    if (this.patchedProto) return;
    const proto = Object.getPrototypeOf(edge);
    if (!proto || typeof proto.updatePath !== "function") return;
    this.patchedProto = proto;
    this.origUpdatePath = proto.updatePath;
    this.origGetBBox = proto.getBBox;
    this.origUpdate = proto.update;
    const controller = this;
    proto.updatePath = function() {
      controller.patchedUpdatePath(this);
    };
    proto.getBBox = function() {
      return controller.patchedGetBBox(this);
    };
    proto.update = function(from, to) {
      controller.patchedUpdate(this, from, to);
    };
  }
  patchedGetBBox(edge) {
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
      maxY: Math.max(fromPt.y, toPt.y)
    };
  }
  patchedUpdatePath(edge) {
    const path = edge.path;
    if (!path?.interaction || !path?.display) {
      this.origUpdatePath?.call(edge);
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
  patchedUpdate(edge, from, to) {
    const canvas = edge.canvas;
    if (this.internalUpdating || !canvas || !canvas.canvasEl?.classList.contains("is-connecting") || !this.lastPointerEvt) {
      this.origUpdate?.call(edge, from, to);
      return;
    }
    const pos = canvas.posFromEvt(this.lastPointerEvt);
    const snapCenter = !this.lastPointerEvt.altKey;
    const fromIsVirtual = !isRealNode(from.node);
    const toIsVirtual = !isRealNode(to.node);
    let nextFrom = from;
    let nextTo = to;
    if (toIsVirtual) {
      setEdgeOffset(edge, "to", void 0);
      this.hidePreviewDot(canvas);
    } else if (fromIsVirtual) {
      setEdgeOffset(edge, "from", void 0);
      this.hidePreviewDot(canvas);
    } else {
      const dFrom = Math.hypot(
        pos.x - (from.node.x + from.node.width / 2),
        pos.y - (from.node.y + from.node.height / 2)
      );
      const dTo = Math.hypot(
        pos.x - (to.node.x + to.node.width / 2),
        pos.y - (to.node.y + to.node.height / 2)
      );
      const movingEnd = from.node !== edge.from.node ? "from" : to.node !== edge.to.node ? "to" : dFrom < dTo ? "from" : "to";
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
  resolveTargetSnap(otherNode, otherSide, otherOffset, targetBBox, pos, snapCenter) {
    const nearest = nearestSideAndOffset(targetBBox, pos, { snapCenter });
    const insideX = pos.x >= targetBBox.minX && pos.x <= targetBBox.maxX;
    const insideY = pos.y >= targetBBox.minY && pos.y <= targetBBox.maxY;
    if (insideX && insideY && nearest.dist > 40) {
      const targetRect = {
        x: targetBBox.minX,
        y: targetBBox.minY,
        width: targetBBox.maxX - targetBBox.minX,
        height: targetBBox.maxY - targetBBox.minY
      };
      const otherRect = {
        x: otherNode.x,
        y: otherNode.y,
        width: otherNode.width,
        height: otherNode.height
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
      point: nearest.point
    };
  }
  // ------------------------------------------------ focused endpoint handles
  syncHandles(canvas) {
    const focused = this.focusedEdgeOf(canvas);
    if (!focused) {
      const pair2 = this.canvasHandles.get(canvas);
      if (pair2) {
        pair2.edge = null;
        pair2.from.hidden = true;
        pair2.to.hidden = true;
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
  syncAllHandles() {
    for (const canvas of this.patchedCanvases.keys()) {
      this.syncHandles(canvas);
    }
  }
  focusedEdgeOf(canvas) {
    if (this.activeDrag && this.activeDrag.canvas === canvas) {
      return this.activeDrag.edge;
    }
    const sel = canvas.selection;
    if (sel && sel.size === 1) {
      const only = sel.values().next().value;
      if (only && typeof only === "object" && "from" in only && "to" in only) {
        return only;
      }
    }
    for (const edge of canvas.edges.values()) {
      if (edge.lineEndGroupEl?.classList.contains("is-focused")) {
        return edge;
      }
    }
    return null;
  }
  ensureHandlePair(canvas) {
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
  makeHandle(canvas, end) {
    const el = document.createElement("div");
    el.className = "jce-edge-handle";
    el.dataset.end = end;
    el.hidden = true;
    el.addEventListener("pointerdown", (evt) => {
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
        moved: false
      };
      canvas.wrapperEl.classList.add("jce-anchor-dragging");
    });
    el.addEventListener("dblclick", (evt) => {
      const pair = this.canvasHandles.get(canvas);
      const edge = pair?.edge;
      if (!edge) return;
      evt.preventDefault();
      evt.stopPropagation();
      canvas.pushHistory?.(canvas.getData());
      setEdgeOffset(edge, end, void 0);
      edge.updatePath?.();
      canvas.markMoved?.(edge);
      canvas.requestSave();
      canvas.requestFrame();
    });
    return el;
  }
  onHandleMove(evt) {
    const drag = this.activeDrag;
    if (!drag) return;
    const { canvas, edge, end } = drag;
    const pos = canvas.posFromEvt(evt);
    const snapCenter = !evt.altKey;
    const fixedNode = end === "from" ? edge.to.node : edge.from.node;
    const currentNode = end === "from" ? edge.from.node : edge.to.node;
    const targetNode = this.findNodeNear(canvas, pos, fixedNode, currentNode);
    const snap = nearestSideAndOffset(bboxOf(targetNode), pos, { snapCenter });
    drag.moved = true;
    setEdgeOffset(edge, end, snap.offset);
    const nextFrom = end === "from" ? { node: targetNode, side: snap.side, end: edge.from.end } : edge.from;
    const nextTo = end === "to" ? { node: targetNode, side: snap.side, end: edge.to.end } : edge.to;
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
  onHandleUp(_evt) {
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
  cancelHandleDrag() {
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
  findNodeNear(canvas, pos, exclude, fallback) {
    const snapDist = 28;
    let best = null;
    let bestDist = Infinity;
    for (const node of canvas.nodes.values()) {
      if (node === exclude || !isRealNode(node)) continue;
      const b = bboxOf(node);
      const inside = pos.x >= b.minX - snapDist && pos.x <= b.maxX + snapDist && pos.y >= b.minY - snapDist && pos.y <= b.maxY + snapDist;
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
  showPreviewDot(canvas, pt, centered) {
    let dot = this.previewDots.get(canvas);
    if (!dot || !canvas.canvasEl.contains(dot)) {
      dot = document.createElement("div");
      dot.className = "jce-anchor-dot";
      canvas.canvasEl.appendChild(dot);
      this.previewDots.set(canvas, dot);
    }
    dot.setCssStyles({ transform: `translate(${pt.x}px, ${pt.y}px)` });
    dot.classList.toggle("is-centered", centered);
    dot.hidden = false;
  }
  hidePreviewDot(canvas) {
    const dot = this.previewDots.get(canvas);
    if (dot) dot.hidden = true;
  }
  hideAllPreviewDots() {
    for (const canvas of this.patchedCanvases.keys()) {
      this.hidePreviewDot(canvas);
    }
  }
};

// src/model.ts
var TAG = "jce";
var ROOT = "jceRoot";
var LAYOUT = "jceLayout";
var FOLD = "jceFold";
var CARD_FOLD = "jceCardFold";
var FOLD_HEIGHT = "jceFoldH";
var FOLD_KIDS = "jceFoldKids";
var CARD_BG = "jceBg";
var CARD_BG_PALETTE = [
  { value: "", zh: "\u9ED8\u8BA4", en: "Default" },
  { value: "#ffffff", zh: "\u767D", en: "White" },
  { value: "#fbf7ee", zh: "\u5976\u6CB9", en: "Cream" },
  { value: "#fbf1c4", zh: "\u9EC4", en: "Yellow" },
  { value: "#e3f1d9", zh: "\u7EFF", en: "Green" },
  { value: "#dfeaf7", zh: "\u84DD", en: "Blue" },
  { value: "#f8e1e4", zh: "\u7C89", en: "Pink" },
  { value: "#ece5f7", zh: "\u7D2B", en: "Purple" },
  { value: "#eeeeee", zh: "\u7070", en: "Grey" }
];
function cardBgOf(node) {
  const value = dataOf(node)[CARD_BG];
  return typeof value === "string" ? value : "";
}
var LAYOUT_ORDER = ["TB", "LR", "BT", "RL"];
function dataOf(node) {
  return node.getData();
}
function kindOf(node) {
  const kind = dataOf(node)[TAG];
  return kind === "note" || kind === "text" || kind === "mindmap" || kind === "section" ? kind : void 0;
}
function isMindmap(node) {
  return kindOf(node) === "mindmap";
}
function rootIdOf(node) {
  const id = dataOf(node)[ROOT];
  return typeof id === "string" ? id : void 0;
}
function layoutOf(canvas, rootId) {
  const root = canvas.nodes.get(rootId);
  const raw = root ? dataOf(root)[LAYOUT] : void 0;
  return raw === "TB" || raw === "LR" || raw === "BT" || raw === "RL" ? raw : "TB";
}
function nextLayout(layout) {
  const i = LAYOUT_ORDER.indexOf(layout);
  return LAYOUT_ORDER[(i + 1) % LAYOUT_ORDER.length];
}
function treeOf(canvas, rootId) {
  const members = /* @__PURE__ */ new Set();
  for (const node of canvas.nodes.values()) {
    if (isMindmap(node) && rootIdOf(node) === rootId) members.add(node.id);
  }
  members.add(rootId);
  const children = /* @__PURE__ */ new Map();
  const parent = /* @__PURE__ */ new Map();
  for (const id of members) children.set(id, []);
  for (const edge of canvas.edges.values()) {
    const from = edge.from.node.id;
    const to = edge.to.node.id;
    if (!members.has(from) || !members.has(to)) continue;
    if (parent.has(to)) continue;
    parent.set(to, from);
    children.get(from).push(to);
  }
  for (const [child, par] of parent) {
    if (!members.has(par)) parent.delete(child);
  }
  return { rootId, layout: layoutOf(canvas, rootId), children, parent };
}
function rootIds(canvas) {
  const out = [];
  for (const node of canvas.nodes.values()) {
    if (!isMindmap(node)) continue;
    const root = rootIdOf(node);
    if (root === node.id) out.push(node.id);
  }
  return out;
}
function descendantsOf(tree, id) {
  const out = [];
  const walk = (current) => {
    for (const child of tree.children.get(current) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}
function hiddenByFold(canvas) {
  const hidden = /* @__PURE__ */ new Set();
  for (const root of rootIds(canvas)) {
    const tree = treeOf(canvas, root);
    for (const [id, kids] of tree.children) {
      if (!kids.length) continue;
      const node = canvas.nodes.get(id);
      if (!node || dataOf(node)[FOLD] !== true) continue;
      for (const d of descendantsOf(tree, id)) hidden.add(d);
    }
  }
  return hidden;
}
function isFolded(canvas, id) {
  const node = canvas.nodes.get(id);
  return !!node && dataOf(node)[FOLD] === true;
}
function hasChildren(canvas, id) {
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id === id && isMindmap(edge.to.node)) return true;
  }
  return false;
}
function childrenOf(canvas, id) {
  const out = [];
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id !== id) continue;
    const child = canvas.nodes.get(edge.to.node.id);
    if (child && isMindmap(child)) out.push(child);
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y);
  return out;
}
function mindmapEdges(canvas) {
  const out = [];
  for (const edge of canvas.edges.values()) {
    if (isMindmap(edge.from.node) && isMindmap(edge.to.node)) out.push(edge);
  }
  return out;
}
function mindmapNodeIds(canvas) {
  const ids = /* @__PURE__ */ new Set();
  for (const node of canvas.nodes.values()) {
    if (isMindmap(node)) ids.add(node.id);
  }
  return ids;
}
function isGroupNode(node) {
  return dataOf(node).type === "group" || kindOf(node) === "section";
}
function isCollapsible(node) {
  return !isMindmap(node);
}
function isCardFolded(node) {
  return dataOf(node)[CARD_FOLD] === true;
}
function foldHeightOf(node) {
  const h = dataOf(node)[FOLD_HEIGHT];
  return typeof h === "number" && Number.isFinite(h) && h > 0 ? h : void 0;
}
function foldKidsOf(node) {
  const kids = dataOf(node)[FOLD_KIDS];
  if (!Array.isArray(kids)) return [];
  return kids.filter((id) => typeof id === "string");
}
function nodesInsideGroup(canvas, group) {
  if (isCardFolded(group)) {
    const out2 = [];
    for (const id of foldKidsOf(group)) {
      const n = canvas.nodes.get(id);
      if (n && n.id !== group.id) out2.push(n);
    }
    return out2;
  }
  const gx1 = group.x;
  const gy1 = group.y;
  const gx2 = group.x + group.width;
  const gy2 = group.y + group.height;
  const out = [];
  for (const node of canvas.nodes.values()) {
    if (node.id === group.id) continue;
    if (isGroupNode(node)) {
      if (node.width >= group.width && node.height >= group.height) continue;
    }
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    if (cx >= gx1 && cx <= gx2 && cy >= gy1 && cy <= gy2) {
      out.push(node);
    }
  }
  return out;
}
function stripMarkdownLine(line) {
  let s = line.trim();
  s = s.replace(/!\[\[[^\]]+\]\]/g, "");
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  s = s.replace(/^#{1,6}\s+/, "");
  s = s.replace(/^[-*+]\s+\[[ xX]\]\s*/, "");
  s = s.replace(/^[-*+]\s+/, "");
  s = s.replace(/^\d+\.\s+/, "");
  s = s.replace(/^>\s+/, "");
  s = s.replace(/<\/?span[^>]*>/gi, "");
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/==([^=]+)==/g, "$1");
  s = s.replace(/==/g, "");
  s = s.replace(/~~([^~]+)~~/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}
function nodeTextContent(node) {
  const data = dataOf(node);
  if (typeof node.text === "string") return node.text;
  if (typeof data.text === "string") return data.text;
  if (typeof node.label === "string") return node.label;
  if (typeof data.label === "string") return data.label;
  if (node.file?.basename) return node.file.basename;
  if (typeof data.file === "string") {
    const base = data.file.split("/").pop() ?? data.file;
    return base.replace(/\.md$/i, "");
  }
  if (typeof data.url === "string") return data.url;
  return "";
}
function nodeTitleOf(node) {
  const data = dataOf(node);
  if (isGroupNode(node)) {
    const lbl = (typeof node.label === "string" ? node.label : void 0) ?? (typeof data.label === "string" ? data.label : "");
    return lbl.trim() || "Section";
  }
  if (data.type === "file") {
    const name = node.file?.basename ?? (typeof data.file === "string" ? (data.file.split("/").pop() ?? data.file).replace(/\.md$/i, "") : "");
    return name.trim() || "\u672A\u547D\u540D\u6587\u4EF6";
  }
  const raw = nodeTextContent(node);
  for (const line of raw.split(/\r?\n/)) {
    const clean = stripMarkdownLine(line);
    if (clean) return clean;
  }
  return kindOf(node) === "text" ? "Text" : "\u672A\u547D\u540D\u5361\u7247";
}
function todoProgressOf(text) {
  if (!text) return null;
  let total = 0;
  let done = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*+]\s+\[([ xX])\]/);
    if (!m) continue;
    total++;
    if (m[1].toLowerCase() === "x") done++;
  }
  return total > 0 ? { done, total } : null;
}

// src/layout.ts
var CHILD_GAP = 56;
var SIB_GAP = 36;
var STEM = 20;
var CORNER = 8;
var ARROW = 7;
var ARROW_HALF = 3.6;
var MM_SIZE = { width: 180, height: 48 };
var KIND_SIZE = {
  note: { width: 280, height: 200 },
  text: { width: 240, height: 72 },
  mindmap: MM_SIZE,
  section: { width: 560, height: 360 }
};
function rectOf(node) {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}
function right(r) {
  return r.x + r.width;
}
function bottom(r) {
  return r.y + r.height;
}
function centerX(r) {
  return r.x + r.width / 2;
}
function centerY(r) {
  return r.y + r.height / 2;
}
function unionRect(rects) {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, right(r));
    maxY = Math.max(maxY, bottom(r));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
function inheritedSize(parent, siblings) {
  const source = siblings.length ? siblings[siblings.length - 1] : parent;
  return {
    width: Math.max(1, Math.round(source.width)),
    height: Math.max(1, Math.round(source.height))
  };
}
function childPosition(parent, siblings, size, layout) {
  const last = siblings[siblings.length - 1];
  switch (layout) {
    case "TB": {
      if (!last) {
        return {
          x: Math.round(centerX(parent) - size.width / 2),
          y: Math.round(bottom(parent) + CHILD_GAP)
        };
      }
      const far = Math.max(...siblings.map(right));
      return { x: Math.round(far + SIB_GAP), y: Math.round(last.y) };
    }
    case "BT": {
      if (!last) {
        return {
          x: Math.round(centerX(parent) - size.width / 2),
          y: Math.round(parent.y - CHILD_GAP - size.height)
        };
      }
      const far = Math.max(...siblings.map(right));
      return { x: Math.round(far + SIB_GAP), y: Math.round(last.y) };
    }
    case "LR": {
      if (!last) {
        return {
          x: Math.round(right(parent) + CHILD_GAP),
          y: Math.round(centerY(parent) - size.height / 2)
        };
      }
      const far = Math.max(...siblings.map(bottom));
      return { x: Math.round(last.x), y: Math.round(far + SIB_GAP) };
    }
    case "RL": {
      if (!last) {
        return {
          x: Math.round(parent.x - CHILD_GAP - size.width),
          y: Math.round(centerY(parent) - size.height / 2)
        };
      }
      const far = Math.max(...siblings.map(bottom));
      return { x: Math.round(last.x), y: Math.round(far + SIB_GAP) };
    }
  }
}
var vertical = (layout) => layout === "TB" || layout === "BT";
var forward = (layout) => layout === "TB" || layout === "LR";
function connector(parent, child, layout) {
  const vert = vertical(layout);
  const sign = forward(layout) ? 1 : -1;
  const stem = STEM;
  const start = vert ? { x: centerX(parent), y: sign > 0 ? bottom(parent) : parent.y } : { x: sign > 0 ? right(parent) : parent.x, y: centerY(parent) };
  const end = vert ? { x: centerX(child), y: sign > 0 ? child.y : bottom(child) } : { x: sign > 0 ? child.x : right(child), y: centerY(child) };
  const span = vert ? (end.y - start.y) * sign : (end.x - start.x) * sign;
  const offset = vert ? end.x - start.x : end.y - start.y;
  const dir = Math.sign(offset) || 1;
  const tip = end;
  const stop = vert ? { x: end.x, y: end.y - sign * ARROW } : { x: end.x - sign * ARROW, y: end.y };
  let d;
  if (Math.abs(offset) < 0.5) {
    d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(stop.x)} ${fmt(stop.y)}`;
  } else if (span < stem + CORNER + 2) {
    const bend = Math.max(4, span * 0.5) * sign;
    d = vert ? `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(start.x)} ${fmt(start.y + bend)} ${fmt(stop.x)} ${fmt(stop.y - bend)} ${fmt(stop.x)} ${fmt(stop.y)}` : `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(start.x + bend)} ${fmt(start.y)} ${fmt(stop.x - bend)} ${fmt(stop.y)} ${fmt(stop.x)} ${fmt(stop.y)}`;
  } else if (vert) {
    const bx = start.x;
    const by = start.y + sign * stem;
    d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(bx)} ${fmt(by - sign * CORNER)} Q ${fmt(bx)} ${fmt(by)} ${fmt(bx + dir * CORNER)} ${fmt(by)} L ${fmt(stop.x - dir * CORNER)} ${fmt(by)} Q ${fmt(stop.x)} ${fmt(by)} ${fmt(stop.x)} ${fmt(by + sign * CORNER)} L ${fmt(stop.x)} ${fmt(stop.y)}`;
  } else {
    const bx = start.x + sign * stem;
    const by = start.y;
    d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(bx - sign * CORNER)} ${fmt(by)} Q ${fmt(bx)} ${fmt(by)} ${fmt(bx)} ${fmt(by + dir * CORNER)} L ${fmt(bx)} ${fmt(stop.y - dir * CORNER)} Q ${fmt(bx)} ${fmt(stop.y)} ${fmt(bx + sign * CORNER)} ${fmt(stop.y)} L ${fmt(stop.x)} ${fmt(stop.y)}`;
  }
  const arrow = vert ? `${fmt(tip.x)},${fmt(tip.y)} ${fmt(tip.x - ARROW_HALF)},${fmt(tip.y - sign * ARROW)} ${fmt(
    tip.x + ARROW_HALF
  )},${fmt(tip.y - sign * ARROW)}` : `${fmt(tip.x)},${fmt(tip.y)} ${fmt(tip.x - sign * ARROW)},${fmt(tip.y - ARROW_HALF)} ${fmt(
    tip.x - sign * ARROW
  )},${fmt(tip.y + ARROW_HALF)}`;
  return { d, arrow };
}
function fmt(n) {
  return (Math.round(n * 10) / 10).toString();
}

// src/overlay.ts
var NS = "http://www.w3.org/2000/svg";
var OVERLAY_CLASS = "jce-overlay";
function overlayFor(canvas) {
  const layer = canvas.canvasEl;
  let svg = layer.querySelector(`svg.${OVERLAY_CLASS}`);
  if (!svg) {
    svg = document.createElementNS(NS, "svg");
    svg.classList.add(OVERLAY_CLASS);
    layer.prepend(svg);
  }
  return svg;
}
function segmentsFor(canvas) {
  const hidden = hiddenByFold(canvas);
  const out = [];
  for (const root of rootIds(canvas)) {
    const tree = treeOf(canvas, root);
    const walk = (id) => {
      if (hidden.has(id)) return;
      const parent = canvas.nodes.get(id);
      if (!parent) return;
      for (const childId of tree.children.get(id) ?? []) {
        if (hidden.has(childId)) continue;
        const child = canvas.nodes.get(childId);
        if (!child) continue;
        out.push(connector(parent, child, tree.layout));
        walk(childId);
      }
    };
    walk(root);
  }
  return out;
}
function drawOverlay(canvas) {
  const svg = overlayFor(canvas);
  const segments = segmentsFor(canvas);
  if (!segments.length) {
    svg.replaceChildren();
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    styleOverlay(svg, 0, 0, 0, 0);
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of segments) {
    for (const pt of pointsOf(seg)) {
      minX = Math.min(minX, pt[0]);
      minY = Math.min(minY, pt[1]);
      maxX = Math.max(maxX, pt[0]);
      maxY = Math.max(maxY, pt[1]);
    }
  }
  const pad = 8;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  svg.setAttribute("viewBox", `${minX} ${minY} ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  styleOverlay(svg, minX, minY, w, h);
  const frag = document.createDocumentFragment();
  for (const seg of segments) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", seg.d);
    path.setAttribute("class", "jce-mm-path");
    frag.appendChild(path);
    const head = document.createElementNS(NS, "polygon");
    head.setAttribute("points", seg.arrow);
    head.setAttribute("class", "jce-mm-arrow");
    frag.appendChild(head);
  }
  svg.replaceChildren(frag);
}
function styleOverlay(svg, left, top, w, h) {
  svg.setCssProps({
    "--jce-ov-left": `${left}px`,
    "--jce-ov-top": `${top}px`,
    "--jce-ov-w": `${w}px`,
    "--jce-ov-h": `${h}px`
  });
}
function pointsOf(seg) {
  const nums = seg.d.match(/-?\d+(\.\d+)?/g) ?? [];
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push([Number(nums[i]), Number(nums[i + 1])]);
  }
  const poly = seg.arrow.match(/-?\d+(\.\d+)?/g) ?? [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    out.push([Number(poly[i]), Number(poly[i + 1])]);
  }
  return out;
}

// src/chrome.ts
var KIND_CLASSES = ["jce-note", "jce-text", "jce-mindmap", "jce-section"];
var IFRAME_STYLE_ID = "jce-iframe-style";
var BASE_IFRAME_CSS = `
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
var HIGHLIGHT_IFRAME_CSS = `
.cm-formatting-highlight { display: none !important; }
.cm-line.HyperMD-task-line[data-task="x"],
.cm-line.HyperMD-task-line[data-task="X"] {
  color: var(--text-faint) !important;
  text-decoration: line-through !important;
  text-decoration-thickness: 1px;
}
`;
var MINDMAP_IFRAME_CSS = `
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
var Chrome = class {
  constructor(plugin, onApplied) {
    this.plugin = plugin;
    this.onApplied = onApplied;
    this.observers = /* @__PURE__ */ new WeakMap();
    this.signatures = /* @__PURE__ */ new WeakMap();
    this.scheduled = /* @__PURE__ */ new WeakSet();
    this.paintedFrames = /* @__PURE__ */ new WeakSet();
  }
  attach(canvas) {
    if (this.observers.has(canvas)) {
      this.schedule(canvas);
      return;
    }
    const observer = new MutationObserver(() => this.schedule(canvas));
    observer.observe(canvas.canvasEl, { childList: true, subtree: true });
    this.observers.set(canvas, observer);
    this.schedule(canvas);
  }
  detach(canvas) {
    this.observers.get(canvas)?.disconnect();
    this.observers.delete(canvas);
    this.signatures.delete(canvas);
  }
  schedule(canvas) {
    if (this.scheduled.has(canvas)) return;
    this.scheduled.add(canvas);
    requestAnimationFrame(() => {
      this.scheduled.delete(canvas);
      this.sync(canvas);
    });
  }
  /** Force the next sync to do full work (after structural changes). */
  invalidate(canvas) {
    this.signatures.delete(canvas);
    this.schedule(canvas);
  }
  sync(canvas) {
    const signature = this.signatureOf(canvas);
    if (this.signatures.get(canvas) === signature) return;
    this.signatures.set(canvas, signature);
    this.apply(canvas);
  }
  signatureOf(canvas) {
    const parts = [
      `z${Math.round(scaleOf(canvas) * 100)}${canvas.wrapperEl.classList.contains("mod-zoomed-out") ? "o" : ""}`
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
          String(node.getData().jceTime ?? ""),
          String(node.nodeEl?.querySelector(".markdown-preview-view")?.childElementCount ?? 0),
          `${text.length}:${text.slice(0, 48)}`
        ].join(":")
      );
    }
    for (const item of canvas.selection ?? []) {
      if (item?.id) parts.push(`s${item.id}`);
    }
    parts.sort();
    return parts.join("|");
  }
  apply(canvas) {
    const mmIds = mindmapNodeIds(canvas);
    for (const node of allNodes(canvas)) {
      this.paintNode(node);
    }
    const mmSelected = Array.from(canvas.selection ?? []).some((n) => !!n?.id && mmIds.has(n.id));
    canvas.wrapperEl.classList.toggle("jce-mm-selected", mmSelected);
    const hidden = hiddenByFold(canvas);
    for (const node of allNodes(canvas)) {
      const isMm = mmIds.has(node.id);
      node.nodeEl.classList.toggle("jce-mm-hidden", isMm && hidden.has(node.id));
      const folded = node.getData().jceFold === true;
      node.nodeEl.classList.toggle("jce-has-fold", isMm && folded);
    }
    for (const edge of mindmapEdges(canvas)) {
      edge.lineGroupEl?.classList.add("jce-hide-native");
      edge.lineEndGroupEl?.classList.add("jce-hide-native");
    }
    this.paintFrames(canvas, mmIds);
    drawOverlay(canvas);
    this.onApplied?.(canvas);
  }
  paintNode(node) {
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
    const bg = kind === "note" ? cardBgOf(node) : "";
    if (bg && /^#[0-9a-f]{3,8}$/i.test(bg)) el.setCssProps({ "--jce-note-bg": bg });
    else el.setCssProps({ "--jce-note-bg": "" });
  }
  /** Editing happens inside a same-origin iframe that Obsidian recreates each
   *  time; paint it on every appearance. Note cards need the white block to go
   *  away as well, otherwise the chosen card colour is hidden while editing. */
  paintFrames(canvas, mmIds) {
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
  paintFrame(frame, css) {
    let doc = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }
    if (!doc?.documentElement) return;
    let style = doc.getElementById(IFRAME_STYLE_ID);
    if (!style) {
      style = doc.createElement("style");
      style.id = IFRAME_STYLE_ID;
      (doc.head ?? doc.documentElement).appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }
};

// src/chronos.ts
var import_obsidian2 = require("obsidian");

// src/chronos-parser.ts
var TIME_OVERRIDE = "jceTime";
var DURATION_PREFIX_RE = /(?:长达|持续|历时|在位|享年|共计|共|达|超过|将近|近|约|大约|前后|不足|逾|余)\s*$/;
function centuryToRange(century, bc) {
  const c = Math.max(1, Math.floor(century));
  if (bc) {
    return { start: -c * 100, end: -(c - 1) * 100 - 1 };
  }
  return { start: (c - 1) * 100 + 1, end: c * 100 };
}
function normalizeRange(a, b) {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}
function isPlausibleYear(y, hasExplicitEraOrUnit) {
  if (!Number.isFinite(y) || y === 0) return false;
  if (y < -4e3 || y > 2200) return false;
  if (!hasExplicitEraOrUnit && y > 0 && y < 100) return false;
  return true;
}
function parseDateCore(core, allowBareNumber) {
  const s = core.trim();
  if (!s) return null;
  const enCentRe = /^(\d{1,2})(?:st|nd|rd|th)\s*(?:[-–—~]\s*(\d{1,2})(?:st|nd|rd|th)\s*)?(?:century|centuries)(?:\s*(BCE|BC|CE|AD))?$/i;
  const ecm = s.match(enCentRe);
  if (ecm) {
    const c1 = Number(ecm[1]);
    const c2Str = ecm[2];
    const era = (ecm[3] ?? "").toUpperCase();
    const bc = era === "BC" || era === "BCE";
    if (c1 < 1 || c1 > 30) return null;
    const r1 = centuryToRange(c1, bc);
    if (!c2Str) return { start: r1.start, end: r1.end, explicitEra: true };
    const c2 = Number(c2Str);
    if (c2 < 1 || c2 > 30) return null;
    const r2 = centuryToRange(c2, bc);
    return { ...normalizeRange(Math.min(r1.start, r2.start), Math.max(r1.end, r2.end)), explicitEra: true };
  }
  const enYearRe = /^(?:(AD|CE)\s*)?(\d{1,4})\s*(?:(BCE|BC|CE|AD)\s*)?(?:[-–—~]\s*(?:(AD|CE)\s*)?(\d{1,4})\s*(BCE|BC|CE|AD)?)?$/i;
  const eym = s.match(enYearRe);
  if (eym && (eym[1] || eym[3] || eym[4] || eym[6])) {
    const pre1 = (eym[1] ?? "").toUpperCase();
    const n1 = Number(eym[2]);
    const post1 = (eym[3] ?? "").toUpperCase();
    const pre2 = (eym[4] ?? "").toUpperCase();
    const n2Str = eym[5];
    const post2 = (eym[6] ?? "").toUpperCase();
    const era1 = pre1 || post1;
    const era2 = pre2 || post2;
    if (!n2Str) {
      const bc = era1 === "BC" || era1 === "BCE";
      const y = bc ? -n1 : n1;
      if (!isPlausibleYear(y, true)) return null;
      return { start: y, end: y, explicitEra: true };
    }
    const n2 = Number(n2Str);
    const bc1 = era1 ? era1 === "BC" || era1 === "BCE" : era2 === "BC" || era2 === "BCE";
    const bc2 = era2 ? era2 === "BC" || era2 === "BCE" : bc1 && n2 < n1;
    const y1 = bc1 ? -n1 : n1;
    const y2 = bc2 ? -n2 : n2;
    if (!isPlausibleYear(y1, true) || !isPlausibleYear(y2, true)) return null;
    return { ...normalizeRange(y1, y2), explicitEra: true };
  }
  const centRe = /^(公元前|公元|前)?\s*(\d{1,2})\s*(?:[-–—~～至到]\s*(公元前|公元|前)?\s*(\d{1,2})\s*)?世纪$/;
  const cm = s.match(centRe);
  if (cm) {
    const era1 = cm[1] ?? "";
    const c1 = Number(cm[2]);
    const era2 = cm[3] ?? "";
    const c2Str = cm[4];
    if (c1 < 1 || c1 > 30) return null;
    const bc1 = era1.includes("\u524D");
    const r1 = centuryToRange(c1, bc1);
    if (!c2Str) {
      return { start: r1.start, end: r1.end, explicitEra: true };
    }
    const c2 = Number(c2Str);
    if (c2 < 1 || c2 > 30) return null;
    const bc2 = era2 ? era2.includes("\u524D") : bc1;
    const r2 = centuryToRange(c2, bc2);
    const norm = normalizeRange(Math.min(r1.start, r2.start), Math.max(r1.end, r2.end));
    return { ...norm, explicitEra: true };
  }
  const rangeRe = /^(公元前|公元|前)?\s*(\d{1,4})\s*年?\s*[-–—~～至到]\s*(公元前|公元|前)?\s*(\d{1,4})\s*(年)?$/;
  const rm = s.match(rangeRe);
  if (rm) {
    const era1 = rm[1] ?? "";
    const n1 = Number(rm[2]);
    const era2 = rm[3] ?? "";
    const n2 = Number(rm[4]);
    const hasYearUnit = Boolean(rm[5]);
    const explicitEra = Boolean(era1 || era2);
    if (!allowBareNumber && !explicitEra && !hasYearUnit) return null;
    const bc1 = era1.includes("\u524D");
    const bc2 = era2 ? era2.includes("\u524D") : bc1 && n2 < n1;
    const y1 = bc1 ? -n1 : n1;
    const y2 = bc2 ? -n2 : n2;
    if (!isPlausibleYear(y1, explicitEra || hasYearUnit) || !isPlausibleYear(y2, explicitEra || hasYearUnit)) {
      return null;
    }
    if (!explicitEra && !hasYearUnit && Math.max(Math.abs(y1), Math.abs(y2)) < 100) {
      return null;
    }
    return { ...normalizeRange(y1, y2), explicitEra };
  }
  const singleRe = /^(公元前|公元|前)?\s*(\d{1,4})\s*(年)?$/;
  const sm = s.match(singleRe);
  if (sm) {
    const era = sm[1] ?? "";
    const n = Number(sm[2]);
    const hasYearUnit = Boolean(sm[3]);
    const explicitEra = Boolean(era);
    if (!allowBareNumber && !explicitEra && !hasYearUnit) return null;
    const y = era.includes("\u524D") ? -n : n;
    if (!isPlausibleYear(y, explicitEra || hasYearUnit)) return null;
    return { start: y, end: y, explicitEra };
  }
  return null;
}
var DATE_TOKEN_RE = new RegExp(
  [
    // 1. Parenthesized (Chinese or English): (公元532-537), （843）, (AD 138–161), (31 BC), (1204–1261), (5th–7th century)
    String.raw`([（(]\s*(?:约\s*|c\.\s*)?(?:(?:公元前|公元|前|AD|CE)\s*)?\d{1,4}(?:st|nd|rd|th)?\s*(?:年\s*|BCE\s*|BC\s*|CE\s*|AD\s*)?(?:[-–—~～至到]\s*(?:(?:公元前|公元|前|AD|CE)\s*)?\d{1,4}(?:st|nd|rd|th)?\s*)?(?:年|世纪|centuries|century|BCE|BC|CE|AD)?(?:\s*(?:BCE|BC|CE|AD|在位|年间|左右|前后|期间))?\s*[)）])`,
    // 2. Explicit Chinese century outside parens: 公元前5-前3世纪, 5-7世纪, 8世纪
    String.raw`((?:公元前|公元|前)?\s*\d{1,2}\s*(?:[-–—~～至到]\s*(?:公元前|公元|前)?\s*\d{1,2}\s*)?世纪)`,
    // 3. Explicit English century outside parens: 2nd century BC, 5th–7th century, 3rd century
    String.raw`(\b\d{1,2}(?:st|nd|rd|th)\s*(?:[-–—~]\s*\d{1,2}(?:st|nd|rd|th)\s*)?(?:centuries|century)(?:\s*(?:BCE|BC|CE|AD)\b)?)`,
    // 4. Explicit English AD/CE/BC/BCE year or range: AD 532–537, 597–586 BC, 721 BC, AD 1, 476 AD
    String.raw`(\b(?:AD|CE)\s+\d{1,4}(?:\s*[-–—~]\s*(?:(?:AD|CE)\s+)?\d{1,4})?\b|\b\d{1,4}\s*[-–—~]\s*\d{1,4}\s*(?:BCE|BC|CE|AD)\b|\b\d{1,4}\s*(?:BCE|BC|CE|AD)\b)`,
    // 5. Explicit Chinese year or year range outside parens:
    //    - with era prefix: 公元前221-前207年, 公元800年, 公元前49
    //    - or with trailing 年: 1054年, 306-337年, 751年
    String.raw`((?:公元前|公元)\s*\d{1,4}\s*(?:年\s*)?(?:[-–—~～至到]\s*(?:(?:公元前|公元|前)\s*)?\d{1,4}\s*)?年?|\b\d{1,4}\s*[-–—~～至到]\s*(?:(?:公元前|公元|前)\s*)?\d{1,4}\s*年|(?<![\d.])\d{1,4}\s*年)`
  ].join("|"),
  "gi"
);
function parseDatesFromText(text) {
  if (!text) return [];
  const results = [];
  DATE_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = DATE_TOKEN_RE.exec(text)) !== null) {
    const raw = m[0];
    const index = m.index;
    const isParen = Boolean(m[1]);
    let inner = raw;
    if (isParen) {
      inner = raw.slice(1, -1).trim().replace(/^(?:约|c\.)\s*/i, "").replace(/\s*(?:在位|年间|左右|前后|期间)$/, "").trim();
    }
    const parsed = parseDateCore(inner, isParen);
    if (!parsed) continue;
    if (!isParen && !parsed.explicitEra) {
      const lookbehind = text.slice(Math.max(0, index - 8), index);
      if (DURATION_PREFIX_RE.test(lookbehind)) continue;
      if (parsed.start === parsed.end && parsed.start > 0 && parsed.start < 100) {
        continue;
      }
    }
    results.push({
      start: parsed.start,
      end: parsed.end,
      raw,
      index,
      length: raw.length
    });
  }
  return results;
}
function parseManualTime(raw) {
  if (!raw || !raw.trim()) return [];
  const parts = raw.split(/[,，;；、]+/);
  const out = [];
  for (const part of parts) {
    const token = part.trim();
    if (!token) continue;
    const negRange = token.match(/^(-?\d{1,4})\s*(?:\.\.|~|～|至|到)\s*(-?\d{1,4})$/);
    if (negRange) {
      const a = Number(negRange[1]);
      const b = Number(negRange[2]);
      if (isPlausibleYear(a, true) && isPlausibleYear(b, true)) {
        const norm = normalizeRange(a, b);
        out.push({ ...norm, raw: token, index: 0, length: token.length });
        continue;
      }
    }
    const negSingle = token.match(/^(-\d{1,4})$/);
    if (negSingle) {
      const y = Number(negSingle[1]);
      if (isPlausibleYear(y, true)) {
        out.push({ start: y, end: y, raw: token, index: 0, length: token.length });
        continue;
      }
    }
    const parsed = parseDateCore(token, true);
    if (parsed) {
      out.push({ start: parsed.start, end: parsed.end, raw: token, index: 0, length: token.length });
    }
  }
  return out;
}
function rangesIntersect(ranges, selStart, selEnd) {
  const lo = Math.min(selStart, selEnd);
  const hi = Math.max(selStart, selEnd);
  for (const r of ranges) {
    if (r.start <= hi && r.end >= lo) return true;
  }
  return false;
}
function formatYear(year, withUnit = false) {
  const y = Math.round(year);
  if (y < 0) return withUnit ? `\u524D${Math.abs(y)}\u5E74` : `\u524D${Math.abs(y)}`;
  return withUnit ? `${y}\u5E74` : `${y}`;
}

// src/chronos.ts
var SKIP_TAGS = /* @__PURE__ */ new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA", "INPUT", "BUTTON"]);
function manualTimeOf(node) {
  const val = node.getData()[TIME_OVERRIDE];
  return typeof val === "string" ? val : "";
}
function nodeTimeRanges(node) {
  const manual = manualTimeOf(node).trim();
  if (manual) return parseManualTime(manual);
  return parseDatesFromText(nodeTextContent(node));
}
var ChronosController = class {
  constructor(plugin, opts) {
    this.plugin = plugin;
    this.states = /* @__PURE__ */ new Map();
    this.onActiveChange = opts?.onActiveChange;
    this.plugin.registerDomEvent(
      window,
      "click",
      (evt) => this.onWindowClick(evt),
      true
    );
    this.plugin.registerDomEvent(
      window,
      "dblclick",
      (evt) => this.onWindowDblClick(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointermove",
      (evt) => this.onPointerMove(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointerup",
      () => this.onPointerUp(),
      true
    );
  }
  isActive(canvas) {
    return this.states.get(canvas)?.active === true;
  }
  toggle(canvas) {
    if (this.isActive(canvas)) {
      this.close(canvas);
      return false;
    }
    this.open(canvas);
    return true;
  }
  open(canvas) {
    const state = this.ensureState(canvas);
    state.active = true;
    this.recompute(canvas, state, true);
    this.ensureBar(canvas, state);
    this.applyAll(canvas, state);
    this.onActiveChange?.(canvas, true);
  }
  close(canvas) {
    const state = this.states.get(canvas);
    if (!state || !state.active) return;
    state.active = false;
    state.focusedEvent = null;
    state.dragging = null;
    state.barEl?.remove();
    state.barEl = null;
    this.clearVisuals(canvas);
    this.onActiveChange?.(canvas, false);
  }
  /** Focus Chronos onto a specific event range (opens Chronos if closed). */
  focusEvent(canvas, nodeId, start, end, raw) {
    const wasActive = this.isActive(canvas);
    const state = this.ensureState(canvas);
    state.active = true;
    this.recompute(canvas, state, !wasActive);
    this.ensureBar(canvas, state);
    if (state.focusedEvent && state.focusedEvent.nodeId === nodeId && state.focusedEvent.start === start && state.focusedEvent.end === end && state.focusedEvent.raw === raw) {
      this.resetRange(canvas, state);
      return;
    }
    state.focusedEvent = { nodeId, start, end, raw };
    this.applyFocusedWindow(state);
    this.applyAll(canvas, state);
    if (!wasActive) this.onActiveChange?.(canvas, true);
  }
  /** Focus Chronos onto a whole node's detected/manual time range (from context menu). */
  focusNode(canvas, node) {
    const ranges = nodeTimeRanges(node);
    if (!ranges.length) {
      this.open(canvas);
      return;
    }
    const start = Math.min(...ranges.map((r) => r.start));
    const end = Math.max(...ranges.map((r) => r.end));
    this.focusEvent(canvas, node.id, start, end, ranges[0].raw);
  }
  /** Open modal to manually specify or clear `jceTime` on a node. */
  openSetTimeModal(canvas, node) {
    new SetTimeModal(this.plugin.app, node, (value) => {
      const next = { ...node.getData() };
      if (value) next[TIME_OVERRIDE] = value;
      else delete next[TIME_OVERRIDE];
      setNodeData(canvas, node, next);
      commit(canvas);
      this.sync(canvas);
    }).open();
  }
  /** Called on canvas frame/DOM updates to keep dates, underlines, and filter fresh. */
  sync(canvas) {
    const state = this.states.get(canvas);
    if (!state || !state.active) return;
    this.recompute(canvas, state, false);
    this.ensureBar(canvas, state);
    this.applyAll(canvas, state);
  }
  detach(canvas) {
    this.close(canvas);
    this.states.delete(canvas);
  }
  destroy() {
    for (const canvas of Array.from(this.states.keys())) {
      this.close(canvas);
    }
    this.states.clear();
  }
  // ----------------------------------------------------------- state & model
  ensureState(canvas) {
    let state = this.states.get(canvas);
    if (!state) {
      state = {
        active: false,
        minYear: 0,
        maxYear: 1e3,
        selStart: 0,
        selEnd: 1e3,
        hasDates: false,
        window30: true,
        focusedEvent: null,
        nodeRanges: /* @__PURE__ */ new Map(),
        barEl: null,
        dragging: null
      };
      this.states.set(canvas, state);
    }
    return state;
  }
  recompute(canvas, state, resetSelection) {
    const prevMin = state.minYear;
    const prevMax = state.maxYear;
    const wasFull = state.selStart <= prevMin && state.selEnd >= prevMax;
    const map = /* @__PURE__ */ new Map();
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of allNodes(canvas)) {
      if (isGroupNode(node)) continue;
      const ranges = nodeTimeRanges(node);
      if (ranges.length > 0) {
        map.set(node.id, ranges);
        for (const r of ranges) {
          if (r.start < minY) minY = r.start;
          if (r.end > maxY) maxY = r.end;
        }
      }
    }
    state.nodeRanges = map;
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      state.hasDates = false;
      state.minYear = 0;
      state.maxYear = 1e3;
      state.selStart = 0;
      state.selEnd = 1e3;
      return;
    }
    if (minY === maxY) {
      minY -= 30;
      maxY += 30;
    }
    state.hasDates = true;
    state.minYear = minY;
    state.maxYear = maxY;
    if (resetSelection || wasFull) {
      state.selStart = minY;
      state.selEnd = maxY;
      state.focusedEvent = null;
    } else if (state.focusedEvent) {
      this.applyFocusedWindow(state);
    } else {
      state.selStart = clamp(state.selStart, minY, maxY);
      state.selEnd = clamp(state.selEnd, state.selStart, maxY);
    }
  }
  applyFocusedWindow(state) {
    const ev = state.focusedEvent;
    if (!ev || !state.hasDates) return;
    const pad = state.window30 ? 30 : 0;
    state.selStart = clamp(ev.start - pad, state.minYear, state.maxYear);
    state.selEnd = clamp(ev.end + pad, state.selStart, state.maxYear);
  }
  resetRange(canvas, state) {
    state.focusedEvent = null;
    state.selStart = state.minYear;
    state.selEnd = state.maxYear;
    this.applyAll(canvas, state);
  }
  // ----------------------------------------------------------- visual apply
  applyAll(canvas, state) {
    canvas.wrapperEl.classList.add("jce-chronos-mode");
    const isFullRange = !state.hasDates || state.selStart <= state.minYear && state.selEnd >= state.maxYear;
    const matchedIds = /* @__PURE__ */ new Set();
    let datedTotal = 0;
    let datedMatched = 0;
    for (const node of allNodes(canvas)) {
      if (isGroupNode(node)) continue;
      const ranges = state.nodeRanges.get(node.id);
      const hasDate = !!ranges && ranges.length > 0;
      if (hasDate) datedTotal++;
      let matched;
      if (isFullRange) {
        matched = true;
        if (hasDate) datedMatched++;
      } else if (hasDate) {
        matched = rangesIntersect(ranges, state.selStart, state.selEnd);
        if (matched) datedMatched++;
      } else {
        matched = true;
      }
      if (matched) matchedIds.add(node.id);
      this.decorateNodeDates(node, state);
      this.applyBlockFiltering(node, state, isFullRange, matched);
    }
    for (const node of allNodes(canvas)) {
      if (!isGroupNode(node)) continue;
      if (isFullRange) {
        matchedIds.add(node.id);
      } else {
        const kids = nodesInsideGroup(canvas, node);
        if (kids.some((k) => matchedIds.has(k.id))) {
          matchedIds.add(node.id);
        }
      }
    }
    for (const node of allNodes(canvas)) {
      const el = node.nodeEl;
      if (!el) continue;
      const hit = matchedIds.has(node.id);
      el.classList.toggle("jce-chronos-match", hit);
      el.classList.toggle("jce-chronos-dim", !hit);
    }
    for (const edge of allEdges(canvas)) {
      const keep = matchedIds.has(edge.from.node.id) && matchedIds.has(edge.to.node.id);
      edge.lineGroupEl?.classList.toggle("jce-chronos-edge-dim", !keep);
      edge.lineEndGroupEl?.classList.toggle("jce-chronos-edge-dim", !keep);
    }
    this.renderBar(canvas, state, datedMatched, datedTotal, isFullRange);
  }
  clearVisuals(canvas) {
    canvas.wrapperEl.classList.remove("jce-chronos-mode", "jce-chronos-only");
    for (const node of allNodes(canvas)) {
      node.nodeEl?.classList.remove("jce-chronos-match", "jce-chronos-dim");
      if (node.nodeEl) {
        clearBlockClasses(node.nodeEl);
        unwrapDates(node.nodeEl);
      }
    }
    for (const edge of allEdges(canvas)) {
      edge.lineGroupEl?.classList.remove("jce-chronos-edge-dim");
      edge.lineEndGroupEl?.classList.remove("jce-chronos-edge-dim");
    }
  }
  // --------------------------------------------------- preview date underline
  decorateNodeDates(node, state) {
    const el = node.nodeEl;
    if (!el) return;
    if (isEditing(node)) {
      unwrapDates(el);
      return;
    }
    const content = el.querySelector(".markdown-preview-view") ?? el.querySelector(".canvas-node-content");
    if (!content) return;
    const existingSpans = content.querySelectorAll(".jce-chronos-date");
    const sig = nodeTextContent(node);
    if (content.dataset.jceChronosSig === sig && existingSpans.length > 0) {
      this.updateActiveDateSpans(existingSpans, node.id, state.focusedEvent);
      return;
    }
    unwrapDates(content);
    content.dataset.jceChronosSig = sig;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode(textNode) {
        const parent = textNode.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest(
          ".jce-chronos-date, .jce-collapsed-bar, .jce-lod-overlay, .cm-editor, a"
        )) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!textNode.nodeValue || textNode.nodeValue.trim().length < 2) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current);
      current = walker.nextNode();
    }
    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      const matches = parseDatesFromText(value);
      if (!matches.length) continue;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const m of matches) {
        if (m.index > cursor) {
          frag.appendChild(document.createTextNode(value.slice(cursor, m.index)));
        }
        const span = document.createElement("span");
        span.className = "jce-chronos-date";
        span.dataset.nodeId = node.id;
        span.dataset.start = String(m.start);
        span.dataset.end = String(m.end);
        span.dataset.raw = m.raw;
        span.textContent = m.raw;
        if (state.focusedEvent && state.focusedEvent.nodeId === node.id && state.focusedEvent.start === m.start && state.focusedEvent.end === m.end && state.focusedEvent.raw === m.raw) {
          span.classList.add("is-active");
        }
        frag.appendChild(span);
        cursor = m.index + m.length;
      }
      if (cursor < value.length) {
        frag.appendChild(document.createTextNode(value.slice(cursor)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }
  updateActiveDateSpans(spans, nodeId, focused) {
    spans.forEach((span) => {
      const active = !!focused && focused.nodeId === nodeId && Number(span.dataset.start) === focused.start && Number(span.dataset.end) === focused.end && span.dataset.raw === focused.raw;
      span.classList.toggle("is-active", active);
    });
  }
  /**
   * Intra-card block filtering for multi-period cards:
   * Only kicks in when a matched card spans MULTIPLE periods (contains at least
   * one date inside `[selStart, selEnd]` AND at least one date outside it).
   * Single-period cards (e.g. a card whose title is "5-7世纪" with explanatory
   * bullets below) stay 100% clear so their body text is never mistakenly dimmed.
   */
  applyBlockFiltering(node, state, isFullRange, cardMatched) {
    const el = node.nodeEl;
    if (!el) return;
    clearBlockClasses(el);
    if (isFullRange || !cardMatched || isEditing(node)) return;
    const content = el.querySelector(".markdown-preview-view") ?? el.querySelector(".canvas-node-content");
    if (!content) return;
    const allSpans = Array.from(content.querySelectorAll(".jce-chronos-date"));
    if (allSpans.length < 2) return;
    let hasInRange = false;
    let hasOutRange = false;
    const spanHit = /* @__PURE__ */ new Map();
    for (const span of allSpans) {
      const s = Number(span.dataset.start);
      const e = Number(span.dataset.end);
      const hit = Number.isFinite(s) && Number.isFinite(e) && rangesIntersect([{ start: s, end: e }], state.selStart, state.selEnd);
      spanHit.set(span, hit);
      if (hit) hasInRange = true;
      else hasOutRange = true;
    }
    if (!hasInRange || !hasOutRange) return;
    const listItems = Array.from(content.querySelectorAll("li"));
    const topParagraphs = Array.from(content.querySelectorAll("p")).filter(
      (p) => !p.closest("li")
    );
    const blocks = [...listItems, ...topParagraphs];
    if (blocks.length < 2) return;
    const ownStatus = /* @__PURE__ */ new Map();
    for (const block of blocks) {
      const ownSpans = Array.from(block.querySelectorAll(".jce-chronos-date")).filter(
        (sp) => sp.closest("li, p") === block
      );
      if (!ownSpans.length) {
        ownStatus.set(block, "none");
      } else if (ownSpans.some((sp) => spanHit.get(sp) === true)) {
        ownStatus.set(block, "hit");
      } else {
        ownStatus.set(block, "miss");
      }
    }
    const keep = /* @__PURE__ */ new Set();
    for (const block of blocks) {
      if (ownStatus.get(block) !== "hit") continue;
      keep.add(block);
      block.classList.add("jce-chronos-block-hit");
      let parentLi = block.parentElement?.closest("li");
      while (parentLi && content.contains(parentLi)) {
        keep.add(parentLi);
        parentLi = parentLi.parentElement?.closest("li");
      }
      if (block.tagName === "LI") {
        const subLis = Array.from(block.querySelectorAll("li"));
        for (const sub of subLis) {
          if (ownStatus.get(sub) !== "miss") {
            keep.add(sub);
          }
        }
      }
    }
    for (const block of blocks) {
      if (keep.has(block)) continue;
      const parentLi = block.parentElement?.closest("li");
      if (parentLi && !keep.has(parentLi) && content.contains(parentLi)) {
        continue;
      }
      block.classList.add("jce-chronos-block-dim");
    }
  }
  // ------------------------------------------------ click & Cmd+click wiring
  onWindowClick(evt) {
    if (evt.button !== 0) return;
    const target = evt.target;
    if (!target) return;
    const wrapper = target.closest?.(".canvas-wrapper");
    const canvas = wrapper ? this.canvasForElement(wrapper) : null;
    if (canvas && this.isActive(canvas) && evt.detail === 1) {
      const dateSpan = findDateSpanAtEvent(canvas, target, evt.clientX, evt.clientY);
      if (dateSpan) {
        const nodeId = dateSpan.dataset.nodeId ?? "";
        const start = Number(dateSpan.dataset.start);
        const end = Number(dateSpan.dataset.end);
        const raw = dateSpan.dataset.raw ?? dateSpan.textContent ?? "";
        if (nodeId && Number.isFinite(start) && Number.isFinite(end)) {
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation?.();
          this.focusEvent(canvas, nodeId, start, end, raw);
        }
        return;
      }
    }
    if (canvas && !this.isActive(canvas) && (evt.metaKey || evt.ctrlKey)) {
      const node = nodeFromEvent(canvas, target);
      if (!node || isEditing(node) || isGroupNode(node)) return;
      const hit = dateAtPointPiercingBlocker(node, evt.clientX, evt.clientY);
      if (!hit) return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation?.();
      this.focusEvent(canvas, node.id, hit.start, hit.end, hit.raw);
    }
  }
  onWindowDblClick(evt) {
    const target = evt.target;
    const dateSpan = target?.closest?.(".jce-chronos-date");
    if (!dateSpan) return;
    const canvas = this.canvasForElement(dateSpan);
    if (!canvas) return;
    const node = nodeFromEvent(canvas, dateSpan);
    if (node && !isEditing(node)) {
      unwrapDates(node.nodeEl);
      node.startEditing?.();
    }
  }
  canvasForElement(el) {
    const wrapper = el.closest(".canvas-wrapper");
    if (!wrapper) return null;
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
      const c = leaf.view.canvas;
      if (c?.wrapperEl === wrapper) return c;
    }
    return null;
  }
  // ------------------------------------------------ minimalist bottom bar UI
  ensureBar(canvas, state) {
    if (state.barEl && state.barEl.isConnected) return state.barEl;
    const host = canvas.wrapperEl.closest(".view-content") ?? canvas.wrapperEl;
    const bar = host.createDiv({ cls: "jce-chronos-bar" });
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());
    const info = bar.createDiv({ cls: "jce-chronos-info" });
    info.createSpan({ cls: "jce-chronos-range" });
    info.createSpan({ cls: "jce-chronos-count" });
    const trackWrap = bar.createDiv({ cls: "jce-chronos-track-wrap" });
    const track = trackWrap.createDiv({ cls: "jce-chronos-track" });
    track.createDiv({ cls: "jce-chronos-rail" });
    const band = track.createDiv({ cls: "jce-chronos-band" });
    const thumbStart = track.createDiv({
      cls: "jce-chronos-thumb",
      attr: { "data-thumb": "start", title: "\u8D77\u59CB\u5E74\u4EFD / Start year" }
    });
    const thumbEnd = track.createDiv({
      cls: "jce-chronos-thumb",
      attr: { "data-thumb": "end", title: "\u7ED3\u675F\u5E74\u4EFD / End year" }
    });
    trackWrap.createDiv({ cls: "jce-chronos-ticks" });
    const startDrag = (kind, evt) => {
      if (evt.button !== 0 || !state.hasDates) return;
      evt.preventDefault();
      evt.stopPropagation();
      const rect = track.getBoundingClientRect();
      state.dragging = {
        kind,
        pointerStartX: evt.clientX,
        origStart: state.selStart,
        origEnd: state.selEnd,
        trackWidth: Math.max(1, rect.width)
      };
      bar.classList.add("is-dragging");
    };
    thumbStart.addEventListener("pointerdown", (e) => startDrag("start", e));
    thumbEnd.addEventListener("pointerdown", (e) => startDrag("end", e));
    band.addEventListener("pointerdown", (e) => startDrag("band", e));
    track.addEventListener("pointerdown", (e) => {
      if (e.target === thumbStart || e.target === thumbEnd || e.target === band) return;
      if (e.button !== 0 || !state.hasDates) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = track.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const year = Math.round(state.minYear + ratio * (state.maxYear - state.minYear));
      state.focusedEvent = null;
      if (Math.abs(year - state.selStart) <= Math.abs(year - state.selEnd)) {
        state.selStart = Math.min(year, state.selEnd);
      } else {
        state.selEnd = Math.max(year, state.selStart);
      }
      this.applyAll(canvas, state);
    });
    const controls = bar.createDiv({ cls: "jce-chronos-controls" });
    const winBtn = controls.createEl("button", {
      type: "button",
      cls: "jce-chronos-chip",
      text: "\xB130\u5E74",
      attr: { "data-act": "win30", title: "\u70B9\u51FB\u6B63\u6587\u65E5\u671F\u65F6\uFF0C\u524D\u540E\u6269\u5C55 \xB130 \u5E74\u67E5\u770B\u540C\u671F\u4E8B\u4EF6" }
    });
    winBtn.addEventListener("mousedown", (e) => e.preventDefault());
    winBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.window30 = !state.window30;
      if (state.focusedEvent) this.applyFocusedWindow(state);
      this.applyAll(canvas, state);
    });
    const resetBtn = controls.createEl("button", {
      type: "button",
      cls: "jce-chronos-action",
      attr: { "data-act": "reset", title: "\u91CD\u7F6E\u4E3A\u5168\u90E8\u5E74\u4EFD / Reset to full range" }
    });
    const resetIcon = resetBtn.createSpan({ cls: "jce-chronos-action-icon" });
    (0, import_obsidian2.setIcon)(resetIcon, "rotate-ccw");
    resetBtn.createSpan({ text: "\u91CD\u7F6E" });
    resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.resetRange(canvas, state);
    });
    const closeBtn = controls.createEl("button", {
      type: "button",
      cls: "jce-chronos-close",
      attr: { "aria-label": "\u5173\u95ED\u65F6\u95F4\u8F74", title: "\u5173\u95ED\u65F6\u95F4\u8F74 / Close Chronos" }
    });
    (0, import_obsidian2.setIcon)(closeBtn, "x");
    closeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close(canvas);
    });
    state.barEl = bar;
    return bar;
  }
  renderBar(_canvas, state, matched, total, isFullRange) {
    const bar = state.barEl;
    if (!bar) return;
    const rangeEl = bar.querySelector(".jce-chronos-range");
    const countEl = bar.querySelector(".jce-chronos-count");
    const trackWrap = bar.querySelector(".jce-chronos-track-wrap");
    const band = bar.querySelector(".jce-chronos-band");
    const thumbStart = bar.querySelector('.jce-chronos-thumb[data-thumb="start"]');
    const thumbEnd = bar.querySelector('.jce-chronos-thumb[data-thumb="end"]');
    const ticksEl = bar.querySelector(".jce-chronos-ticks");
    if (!state.hasDates) {
      if (rangeEl) rangeEl.textContent = "\u672A\u68C0\u6D4B\u5230\u5E74\u4EFD";
      if (countEl) countEl.textContent = "\u53F3\u952E\u5361\u7247\u53EF\u6307\u5B9A";
      trackWrap?.classList.add("is-empty");
    } else {
      trackWrap?.classList.remove("is-empty");
      if (rangeEl) {
        rangeEl.textContent = state.selStart === state.selEnd ? formatYear(state.selStart, true) : `${formatYear(state.selStart)} \u2014 ${formatYear(state.selEnd)}`;
      }
      if (countEl) countEl.textContent = `${matched}/${total}`;
      const span = Math.max(1, state.maxYear - state.minYear);
      const p1 = clamp((state.selStart - state.minYear) / span * 100, 0, 100);
      const p2 = clamp((state.selEnd - state.minYear) / span * 100, p1, 100);
      if (band) {
        band.setCssStyles({
          left: `${p1}%`,
          width: `${Math.max(0.5, p2 - p1)}%`
        });
      }
      if (thumbStart) thumbStart.setCssStyles({ left: `${p1}%` });
      if (thumbEnd) thumbEnd.setCssStyles({ left: `${p2}%` });
      if (ticksEl) {
        const sig = `${state.minYear}:${state.maxYear}`;
        if (ticksEl.dataset.sig !== sig) {
          ticksEl.dataset.sig = sig;
          ticksEl.empty();
          const steps = 4;
          for (let i = 0; i <= steps; i++) {
            const y = Math.round(state.minYear + (state.maxYear - state.minYear) * i / steps);
            ticksEl.createSpan({ cls: "jce-chronos-tick", text: formatYear(y) });
          }
        }
      }
    }
    const winBtn = bar.querySelector('[data-act="win30"]');
    winBtn?.classList.toggle("is-on", state.window30);
    const resetBtn = bar.querySelector('[data-act="reset"]');
    if (resetBtn) {
      resetBtn.hidden = isFullRange;
    }
  }
  onPointerMove(evt) {
    for (const [canvas, state] of this.states) {
      if (!state.dragging || !state.hasDates) continue;
      const { kind, pointerStartX, origStart, origEnd, trackWidth } = state.dragging;
      const dx = evt.clientX - pointerStartX;
      const span = state.maxYear - state.minYear;
      const deltaYears = Math.round(dx / trackWidth * span);
      state.focusedEvent = null;
      if (kind === "start") {
        state.selStart = clamp(origStart + deltaYears, state.minYear, state.selEnd);
      } else if (kind === "end") {
        state.selEnd = clamp(origEnd + deltaYears, state.selStart, state.maxYear);
      } else {
        const width = origEnd - origStart;
        const nextStart = clamp(origStart + deltaYears, state.minYear, state.maxYear - width);
        state.selStart = nextStart;
        state.selEnd = nextStart + width;
      }
      this.applyAll(canvas, state);
    }
  }
  onPointerUp() {
    for (const state of this.states.values()) {
      if (!state.dragging) continue;
      state.dragging = null;
      state.barEl?.classList.remove("is-dragging");
    }
  }
};
var SetTimeModal = class extends import_obsidian2.Modal {
  constructor(app, node, onSubmit) {
    super(app);
    this.node = node;
    this.onSubmit = onSubmit;
    this.value = manualTimeOf(node);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jce-time-modal");
    contentEl.createEl("h3", { text: "\u6307\u5B9A\u5361\u7247\u5E74\u4EFD / Set Card Time" });
    const autoRanges = parseDatesFromText(nodeTextContent(this.node));
    const autoText = autoRanges.length ? autoRanges.map(
      (r) => r.start === r.end ? formatYear(r.start, true) : `${formatYear(r.start)}\u2014${formatYear(r.end, true)}`
    ).join("\u3001") : "\u65E0";
    contentEl.createDiv({
      cls: "jce-time-hint",
      text: `\u81EA\u52A8\u8BC6\u522B\uFF1A${autoText}\uFF08\u7559\u7A7A\u4FDD\u5B58\u5C06\u6062\u590D\u81EA\u52A8\u8BC6\u522B\uFF0C\u4E0D\u4FEE\u6539\u6B63\u6587\uFF09`
    });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "jce-time-input",
      attr: {
        placeholder: "\u4F8B\u5982\uFF1A1054\u3001532-537\u3001\u516C\u5143\u524D221-\u524D207\u3001532-537, 1054"
      }
    });
    input.value = this.value;
    const preview = contentEl.createDiv({ cls: "jce-time-preview" });
    const updatePreview = () => {
      const v = input.value.trim();
      if (!v) {
        preview.textContent = "\u5C06\u4F7F\u7528\u6B63\u6587\u81EA\u52A8\u8BC6\u522B\u7ED3\u679C";
        preview.classList.remove("is-invalid");
        return;
      }
      const parsed = parseManualTime(v);
      if (!parsed.length) {
        preview.textContent = "\u672A\u80FD\u89E3\u6790\u4E3A\u6709\u6548\u5E74\u4EFD\uFF0C\u8BF7\u68C0\u67E5\u683C\u5F0F";
        preview.classList.add("is-invalid");
      } else {
        preview.textContent = "\u89E3\u6790\u7ED3\u679C\uFF1A" + parsed.map(
          (r) => r.start === r.end ? formatYear(r.start, true) : `${formatYear(r.start)} \u2014 ${formatYear(r.end, true)}`
        ).join(" \xB7 ");
        preview.classList.remove("is-invalid");
      }
    };
    updatePreview();
    input.addEventListener("input", updatePreview);
    const actions = contentEl.createDiv({ cls: "jce-time-actions" });
    const clearBtn = actions.createEl("button", { type: "button", text: "\u6E05\u9664\u8986\u76D6" });
    clearBtn.addEventListener("click", () => {
      this.onSubmit("");
      this.close();
    });
    const saveBtn = actions.createEl("button", {
      type: "button",
      cls: "mod-cta",
      text: "\u4FDD\u5B58"
    });
    const commitModal = () => {
      this.onSubmit(input.value.trim());
      this.close();
    };
    saveBtn.addEventListener("click", commitModal);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitModal();
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 20);
  }
  onClose() {
    this.contentEl.empty();
  }
};
function clearBlockClasses(root) {
  root.querySelectorAll(".jce-chronos-block-dim, .jce-chronos-block-hit").forEach((el) => {
    el.classList.remove("jce-chronos-block-dim", "jce-chronos-block-hit");
  });
}
function unwrapDates(root) {
  const spans = root.querySelectorAll(".jce-chronos-date");
  if (!spans.length) {
    if (root.dataset.jceChronosSig) delete root.dataset.jceChronosSig;
    return;
  }
  const parents = /* @__PURE__ */ new Set();
  spans.forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    parents.add(parent);
    parent.replaceChild(document.createTextNode(span.textContent ?? ""), span);
  });
  parents.forEach((p) => p.normalize());
  root.querySelectorAll("[data-jce-chronos-sig]").forEach((el) => {
    delete el.dataset.jceChronosSig;
  });
  delete root.dataset.jceChronosSig;
}
function findDateSpanAtEvent(canvas, target, clientX, clientY) {
  const direct = target.closest?.(".jce-chronos-date");
  if (direct) return direct;
  const node = nodeFromEvent(canvas, target);
  if (!node || isEditing(node) || isGroupNode(node)) return null;
  const spans = node.nodeEl.querySelectorAll(".jce-chronos-date");
  for (const span of Array.from(spans)) {
    const rects = span.getClientRects();
    for (const r of Array.from(rects)) {
      if (clientX >= r.left - 2 && clientX <= r.right + 2 && clientY >= r.top - 2 && clientY <= r.bottom + 2) {
        return span;
      }
    }
  }
  return null;
}
function dateAtPointPiercingBlocker(node, x, y) {
  const blocker = node.nodeEl.querySelector(".canvas-node-content-blocker");
  blocker?.classList.add("jce-pierce-blocker");
  try {
    return dateAtPoint(x, y);
  } finally {
    blocker?.classList.remove("jce-pierce-blocker");
  }
}
function dateAtPoint(x, y) {
  const doc = document;
  const range = doc.caretRangeFromPoint?.(x, y);
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const text = range.startContainer.nodeValue ?? "";
  const offset = range.startOffset;
  const matches = parseDatesFromText(text);
  for (const m of matches) {
    if (offset >= m.index && offset <= m.index + m.length) {
      return m;
    }
  }
  return null;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// src/collapse.ts
var import_obsidian3 = require("obsidian");
var COLLAPSED_CARD_H = 48;
var COLLAPSED_GROUP_H = 44;
var MIN_EXPANDED_H = 72;
var MIN_GROUP_EXPANDED_H = 140;
var CardCollapseController = class {
  constructor() {
    this.lastGroupPos = /* @__PURE__ */ new WeakMap();
  }
  toggle(canvas, nodeId) {
    const node = canvas.nodes.get(nodeId);
    if (!node || !isCollapsible(node)) return;
    if (isCardFolded(node)) this.expand(canvas, node);
    else this.collapse(canvas, node);
  }
  collapse(canvas, node) {
    if (!isCollapsible(node) || isCardFolded(node)) return;
    if (node.isEditing) node.blur?.();
    const isGroup = isGroupNode(node);
    const prevH = Math.max(
      Math.round(node.height),
      isGroup ? MIN_GROUP_EXPANDED_H : MIN_EXPANDED_H
    );
    const targetH = isGroup ? COLLAPSED_GROUP_H : COLLAPSED_CARD_H;
    const patch = {
      ...node.getData(),
      height: targetH,
      [CARD_FOLD]: true,
      [FOLD_HEIGHT]: prevH
    };
    if (isGroup) {
      const kids = nodesInsideGroup(canvas, node).map((k) => k.id);
      patch[FOLD_KIDS] = kids;
      this.lastGroupPos.set(node, { x: node.x, y: node.y });
    }
    node.setData(patch);
    setNodeRect(node, { x: node.x, y: node.y, width: node.width, height: targetH });
    commit(canvas);
    this.sync(canvas);
  }
  expand(canvas, node) {
    if (!isCardFolded(node)) return;
    const isGroup = isGroupNode(node);
    if (isGroup) this.translateFoldedChildren(canvas, node);
    const fallbackH = isGroup ? KIND_SIZE.section.height : kindOf(node) === "text" ? KIND_SIZE.text.height : KIND_SIZE.note.height;
    const restoredH = Math.max(
      foldHeightOf(node) ?? fallbackH,
      isGroup ? MIN_GROUP_EXPANDED_H : MIN_EXPANDED_H
    );
    const next = { ...node.getData(), height: restoredH };
    delete next[CARD_FOLD];
    delete next[FOLD_HEIGHT];
    delete next[FOLD_KIDS];
    node.setData(next);
    setNodeRect(node, { x: node.x, y: node.y, width: node.width, height: restoredH });
    this.lastGroupPos.delete(node);
    commit(canvas);
    this.sync(canvas);
  }
  /** Expand any folded section that currently hides `nodeId` (e.g. from Search). */
  expandContainingGroup(canvas, nodeId) {
    for (const node of allNodes(canvas)) {
      if (!isGroupNode(node) || !isCardFolded(node)) continue;
      if (foldKidsOf(node).includes(nodeId)) {
        this.expand(canvas, node);
      }
    }
  }
  sync(canvas) {
    const nodes = allNodes(canvas);
    for (const node of nodes) {
      if (!isCollapsible(node) || !isCardFolded(node)) continue;
      const isGroup = isGroupNode(node);
      const maxFoldH = (isGroup ? COLLAPSED_GROUP_H : COLLAPSED_CARD_H) + 20;
      if (node.height > maxFoldH) {
        const next = { ...node.getData() };
        delete next[CARD_FOLD];
        delete next[FOLD_HEIGHT];
        delete next[FOLD_KIDS];
        node.setData(next);
        this.lastGroupPos.delete(node);
        canvas.requestSave();
        continue;
      }
      if (isGroup) {
        this.translateFoldedChildren(canvas, node);
      }
    }
    const hiddenBySec = /* @__PURE__ */ new Set();
    for (const node of nodes) {
      if (!isGroupNode(node) || !isCardFolded(node)) continue;
      for (const id of foldKidsOf(node)) {
        if (id !== node.id) hiddenBySec.add(id);
      }
    }
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
    for (const edge of allEdges(canvas)) {
      const hide = hiddenBySec.has(edge.from.node.id) || hiddenBySec.has(edge.to.node.id);
      edge.lineGroupEl?.classList.toggle("jce-sec-hidden", hide);
      edge.lineEndGroupEl?.classList.toggle("jce-sec-hidden", hide);
    }
  }
  detach(canvas) {
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
  translateFoldedChildren(canvas, node) {
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
  syncFoldButton(canvas, node, host, folded) {
    let btn = host.querySelector(":scope > .jce-fold-btn");
    if (!btn) {
      btn = host.createEl("button", {
        type: "button",
        cls: "jce-fold-btn"
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
      (0, import_obsidian3.setIcon)(btn, folded ? "chevrons-down-up" : "chevrons-up-down");
      const tip = folded ? "\u5C55\u5F00 / Expand" : "\u6298\u53E0 / Collapse";
      btn.title = tip;
      btn.setAttribute("aria-label", tip);
    }
  }
  syncCollapsedBar(canvas, node, host, folded, isGroup) {
    let bar = host.querySelector(":scope > .jce-collapsed-bar");
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
    const meta = isGroup ? `${foldKidsOf(node).length} \u5F20\u5361` : (() => {
      const p = todoProgressOf(nodeTextContent(node));
      return p ? `${p.done}/${p.total}` : "";
    })();
    const sig = `${title}
${meta}`;
    if (bar.dataset.sig !== sig) {
      bar.dataset.sig = sig;
      const titleEl = bar.querySelector(".jce-collapsed-title");
      const metaEl = bar.querySelector(".jce-collapsed-meta");
      if (titleEl) titleEl.textContent = title;
      if (metaEl) {
        metaEl.textContent = meta;
        metaEl.hidden = !meta;
      }
    }
  }
};
function setNodeRect(node, rect) {
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

// src/connect.ts
var ConnectTool = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.canvas = null;
    this.from = null;
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt) => this.onPointerDown(evt),
      true
    );
  }
  get active() {
    return !!this.canvas;
  }
  enter(canvas) {
    this.exit();
    this.canvas = canvas;
    canvas.wrapperEl.classList.add("jce-connecting");
  }
  exit() {
    this.clearFrom();
    this.canvas?.wrapperEl.classList.remove("jce-connecting");
    this.canvas = null;
  }
  onPointerDown(evt) {
    if (!this.canvas) return;
    if (evt.button !== 0) return;
    if (isInsideCanvasUi(evt.target)) return;
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
  clearFrom() {
    this.from?.nodeEl.classList.remove("jce-connect-from");
    this.from = null;
  }
};

// src/focus.ts
var FocusController = class {
  constructor() {
    this.states = /* @__PURE__ */ new Map();
  }
  isActive(canvas) {
    return this.states.has(canvas);
  }
  toggle(canvas) {
    if (this.isActive(canvas)) {
      this.exit(canvas);
      return false;
    }
    const sel = selectedNodes(canvas);
    if (!sel.length) return false;
    this.enter(canvas, sel);
    return true;
  }
  enter(canvas, targets) {
    if (!targets.length) {
      this.exit(canvas);
      return;
    }
    const focusedIds = computeFocusIds(canvas, targets);
    const pillEl = this.ensurePill(canvas);
    const state = {
      focusedIds,
      selectionSig: sigOf(targets),
      pillEl
    };
    this.states.set(canvas, state);
    canvas.wrapperEl.classList.add("jce-focus-mode");
    this.applyClasses(canvas, focusedIds);
  }
  exit(canvas) {
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
  sync(canvas) {
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
  onCanvasBlankClick(canvas) {
    if (!this.isActive(canvas)) return;
    this.exit(canvas);
  }
  detach(canvas) {
    this.exit(canvas);
  }
  destroy() {
    for (const canvas of Array.from(this.states.keys())) {
      this.exit(canvas);
    }
  }
  applyClasses(canvas, focusedIds) {
    for (const node of allNodes(canvas)) {
      node.nodeEl?.classList.toggle("jce-focused-item", focusedIds.has(node.id));
    }
    for (const edge of allEdges(canvas)) {
      const keep = focusedIds.has(edge.from.node.id) && focusedIds.has(edge.to.node.id);
      edge.lineGroupEl?.classList.toggle("jce-focus-dim", !keep);
      edge.lineEndGroupEl?.classList.toggle("jce-focus-dim", !keep);
    }
  }
  ensurePill(canvas) {
    const existing = this.states.get(canvas)?.pillEl;
    if (existing && existing.isConnected) return existing;
    const host = canvas.wrapperEl.closest(".view-content") ?? canvas.wrapperEl;
    const pill = host.createDiv({ cls: "jce-focus-pill" });
    pill.createSpan({ cls: "jce-focus-dot" });
    pill.createSpan({ cls: "jce-focus-label", text: "\u805A\u7126\u6A21\u5F0F \xB7 \u70B9\u51FB\u7A7A\u767D\u6216\u6309 Esc \u9000\u51FA" });
    const btn = pill.createEl("button", {
      type: "button",
      cls: "jce-focus-exit",
      text: "\u9000\u51FA"
    });
    btn.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    btn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.exit(canvas);
    });
    return pill;
  }
};
function computeFocusIds(canvas, targets) {
  const ids = /* @__PURE__ */ new Set();
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
function sigOf(nodes) {
  return nodes.map((n) => n.id).sort().join(",");
}

// src/format.ts
var import_view = require("@codemirror/view");
var import_obsidian4 = require("obsidian");
var BUTTONS = [
  { id: "bold", glyph: "B", label: "\u7C97\u4F53 / Bold  \u2318B", group: 0 },
  { id: "italic", glyph: "I", label: "\u659C\u4F53 / Italic  \u2318I", group: 0 },
  { id: "underline", glyph: "U", label: "\u4E0B\u5212\u7EBF / Underline  \u2318U", group: 0 },
  { id: "code", glyph: "</>", label: "\u884C\u5185\u4EE3\u7801 / Inline code", group: 1 },
  { id: "highlight", glyph: "H", label: "\u9AD8\u4EAE / Highlight", group: 1 },
  { id: "strike", glyph: "S", label: "\u5220\u9664\u7EBF / Strikethrough", group: 0 },
  { id: "link", glyph: "\u2197", label: "\u94FE\u63A5 / Link  \u2318K", group: 2 },
  { id: "math", glyph: "\u2211", label: "\u6570\u5B66 / Math", group: 2 },
  { id: "color", glyph: "A", label: "\u6587\u5B57\u989C\u8272 / Text color", group: 3 },
  { id: "bg", glyph: "", label: "\u6587\u5B57\u80CC\u666F\u8272 / Background color", group: 3 }
];
var TEXT_COLORS = ["#111111", "#6b6b6b", "#c0392b", "#d35400", "#1e8449", "#1a5276", "#6c3483"];
var BG_COLORS = ["#f7e89c", "#c8efc4", "#c5e4f7", "#f5c6d0", "#e4e4e4"];
var FormatBar = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.hooked = /* @__PURE__ */ new WeakSet();
    this.followFrame = 0;
    this.syncTimer = 0;
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
    this.plugin.register(() => {
      this.hide();
      this.el.remove();
    });
    this.plugin.registerDomEvent(document, "mouseup", () => this.schedule(), true);
    this.plugin.registerDomEvent(document, "keyup", () => this.schedule(), true);
    this.plugin.registerDomEvent(document, "selectionchange", () => this.schedule());
    this.plugin.registerDomEvent(document, "wheel", () => this.schedule(), true);
    this.plugin.registerDomEvent(window, "resize", () => this.schedule());
  }
  // -------------------------------------------------------------------- ui
  build() {
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
        el.classList.add("jce-fmt-icon");
        (0, import_obsidian4.setIcon)(el, "paint-bucket");
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
    apply.textContent = "\u786E\u5B9A";
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
  hide() {
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
  resolve() {
    for (const frame of this.frames()) {
      let doc = null;
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
      const view = findView(content);
      if (view && !view.state.selection.main.empty) return { view, frame };
    }
    return null;
  }
  frames() {
    const canvas = this.activeCanvas();
    if (!canvas) return [];
    return Array.from(canvas.canvasEl.querySelectorAll(".canvas-node iframe"));
  }
  activeCanvas() {
    const view = this.plugin.app.workspace.getActiveViewOfType(import_obsidian4.FileView);
    if (!view || view.getViewType() !== "canvas") return null;
    return view.canvas ?? null;
  }
  /** Hook every editing iframe on a canvas (they are recreated per session). */
  hookCanvas(canvas) {
    const frames = Array.from(
      canvas.canvasEl.querySelectorAll(".canvas-node iframe")
    );
    if (!frames.length) return;
    for (const frame of frames) {
      let doc = null;
      try {
        doc = frame.contentDocument;
      } catch {
        continue;
      }
      if (doc) this.hook(doc);
    }
  }
  hook(doc) {
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
  selectionRect(target) {
    const main = target.view.state.selection.main;
    if (main.empty) return null;
    const coords = target.view.coordsAtPos;
    if (typeof coords !== "function") return null;
    const a = coords.call(target.view, main.from, 1);
    const b = coords.call(target.view, main.to, -1);
    if (!a || !b) return null;
    const left = Math.min(a.left, b.left);
    const right2 = Math.max(a.right ?? a.left, b.right ?? b.left);
    const top = Math.min(a.top, b.top);
    const bottom2 = Math.max(a.bottom, b.bottom);
    const inner = new DOMRect(left, top, Math.max(1, right2 - left), Math.max(1, bottom2 - top));
    const frame = target.frame;
    if (!frame) return inner;
    const box = frame.getBoundingClientRect();
    const win = frame.contentWindow;
    const vw = win?.innerWidth || box.width || 1;
    const vh = win?.innerHeight || box.height || 1;
    const sx = box.width / vw;
    const sy = box.height / vh;
    return new DOMRect(
      box.left + inner.left * sx,
      box.top + inner.top * sy,
      inner.width * sx,
      inner.height * sy
    );
  }
  place(rect) {
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    const canvas = this.activeCanvas();
    const leftEdge = canvas ? canvas.wrapperEl.getBoundingClientRect().left : 0;
    const minLeft = leftEdge > 0 ? leftEdge + 76 : 8;
    const centered = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(window.innerWidth - width - 8, Math.max(minLeft, centered));
    let top = rect.top - height - 8;
    if (top < 8) top = Math.min(window.innerHeight - height - 8, rect.bottom + 8);
    this.el.setCssProps({
      "--jce-fmt-left": `${Math.round(left)}px`,
      "--jce-fmt-top": `${Math.round(top)}px`
    });
  }
  schedule() {
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => this.sync(), 0);
  }
  sync() {
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
  startFollow() {
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
  run(id) {
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
    const pairs = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      underline: ["<u>", "</u>"],
      code: ["`", "`"],
      highlight: ["==", "=="],
      strike: ["~~", "~~"],
      math: ["$", "$"]
    };
    const pair = pairs[id];
    if (!pair) return;
    toggleWrap(target.view, pair[0], pair[1]);
    this.schedule();
  }
  applyLink(target, url) {
    const main = target.view.state.selection.main;
    const text = target.view.state.sliceDoc(main.from, main.to);
    if (!url) return;
    const label = text || url;
    const insert = `[${label}](${url})`;
    target.view.dispatch({
      changes: { from: main.from, to: main.to, insert },
      selection: { anchor: main.from + insert.length }
    });
    target.view.focus();
  }
  showColors(target, kind) {
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
        swatch.title = "\u6E05\u9664 / Clear";
      } else {
        swatch.setCssProps({ "--jce-swatch-bg": hex });
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
};
function findView(el) {
  try {
    const view = import_view.EditorView.findFromDOM(el);
    if (view && view.state?.selection) return view;
  } catch {
  }
  return null;
}
function toggleWrap(view, left, right2) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  if (!text) return;
  if (!text.includes("\n")) {
    const caret2 = toggleRange(view, from, to, left, right2);
    setCaret(view, caret2);
    return;
  }
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  let caret = null;
  for (let n = last.number; n >= first.number; n--) {
    const line = view.state.doc.line(n);
    const a = n === first.number ? Math.max(from, line.from) : line.from;
    const b = n === last.number ? Math.min(to, line.to) : line.to;
    if (!view.state.sliceDoc(a, b).trim()) continue;
    const next = toggleRange(view, a, b, left, right2);
    if (caret === null) caret = next;
  }
  setCaret(view, caret ?? to);
}
function setCaret(view, pos) {
  const docLength = view.state.doc.length;
  view.dispatch({ selection: { anchor: Math.max(0, Math.min(pos, docLength)) } });
  view.focus();
}
function toggleRange(view, from, to, left, right2) {
  const text = view.state.sliceDoc(from, to);
  const inner = unwrap(text, left, right2);
  if (inner !== null) {
    view.dispatch({ changes: { from, to, insert: inner } });
    return from + inner.length;
  }
  if (isMarker(view, from - left.length, left, -1) && isMarker(view, to, right2, 1)) {
    view.dispatch({
      changes: [
        { from: from - left.length, to: from, insert: "" },
        { from: to, to: to + right2.length, insert: "" }
      ]
    });
    return from - left.length + text.length;
  }
  const insert = left + text + right2;
  view.dispatch({ changes: { from, to, insert } });
  return from + insert.length;
}
function unwrap(text, left, right2) {
  if (text.length <= left.length + right2.length) return null;
  if (!text.startsWith(left) || !text.endsWith(right2)) return null;
  return text.slice(left.length, text.length - right2.length);
}
function isMarker(view, pos, marker, dir) {
  if (pos < 0) return false;
  const docLength = view.state.doc.length;
  if (dir < 0) {
    if (pos + marker.length > docLength) return false;
    if (view.state.sliceDoc(pos, pos + marker.length) !== marker) return false;
    if (marker.length === 1 && pos > 0 && view.state.sliceDoc(pos - 1, pos) === marker) return false;
    return true;
  }
  if (pos + marker.length > docLength) return false;
  if (view.state.sliceDoc(pos, pos + marker.length) !== marker) return false;
  if (marker.length === 1 && pos + 1 < docLength && view.state.sliceDoc(pos + 1, pos + 2) === marker) {
    return false;
  }
  return true;
}
var stylePattern = (prop, value) => new RegExp(`^<span style="${prop}:\\s*${escapeRe(value)}\\s*">([\\s\\S]*)</span>$`);
var anyStylePattern = (prop) => new RegExp(`^<span style="${prop}:\\s*[^"]+\\s*">([\\s\\S]*)</span>$`);
function wrapStyle(view, prop, value) {
  const main = view.state.selection.main;
  const text = view.state.sliceDoc(main.from, main.to);
  if (!text) return;
  const lines = lineRanges(view, main.from, main.to);
  let caret = null;
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
function clearStyle(view, prop) {
  const main = view.state.selection.main;
  const lines = lineRanges(view, main.from, main.to);
  let caret = null;
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
function lineRanges(view, from, to) {
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  const out = [];
  for (let n = first.number; n <= last.number; n++) {
    const line = view.state.doc.line(n);
    out.push({
      from: n === first.number ? Math.max(from, line.from) : line.from,
      to: n === last.number ? Math.min(to, line.to) : line.to
    });
  }
  return out;
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/minimap.ts
var import_obsidian5 = require("obsidian");
var MAP_W = 208;
var MAP_H = 136;
var PAD = 10;
var MinimapController = class {
  constructor(initialOpen, onToggleChange) {
    this.onToggleChange = onToggleChange;
    this.states = /* @__PURE__ */ new Map();
    this.open = initialOpen;
  }
  isOpen() {
    return this.open;
  }
  setOpen(open, canvases) {
    this.open = open;
    this.onToggleChange(open);
    for (const canvas of canvases) {
      this.sync(canvas);
    }
  }
  toggle(canvases) {
    this.setOpen(!this.open, canvases);
    return this.open;
  }
  sync(canvas) {
    if (!this.open) {
      const st2 = this.states.get(canvas);
      if (st2) st2.rootEl.hidden = true;
      return;
    }
    const st = this.ensureState(canvas);
    if (!st) return;
    st.rootEl.hidden = false;
    this.scheduleDraw(canvas, st);
  }
  detach(canvas) {
    const st = this.states.get(canvas);
    if (!st) return;
    if (st.raf) cancelAnimationFrame(st.raf);
    st.rootEl.remove();
    this.states.delete(canvas);
  }
  destroy() {
    for (const canvas of Array.from(this.states.keys())) {
      this.detach(canvas);
    }
  }
  ensureState(canvas) {
    const existing = this.states.get(canvas);
    if (existing && existing.rootEl.isConnected) return existing;
    existing?.rootEl.remove();
    const host = canvas.wrapperEl.closest(".view-content");
    if (!host) return null;
    const rootEl = host.createDiv({
      cls: "jce-minimap",
      attr: { "aria-label": "\u5C0F\u5730\u56FE / Minimap" }
    });
    rootEl.hidden = !this.open;
    const closeBtn = rootEl.createEl("button", {
      type: "button",
      cls: "jce-minimap-close",
      attr: { title: "\u9690\u85CF\u5C0F\u5730\u56FE / Hide minimap", "aria-label": "Hide minimap" }
    });
    (0, import_obsidian5.setIcon)(closeBtn, "x");
    const canvasEl = rootEl.createEl("canvas", { cls: "jce-minimap-canvas" });
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvasEl.width = Math.round(MAP_W * dpr);
    canvasEl.height = Math.round(MAP_H * dpr);
    const ctx = canvasEl.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const state = {
      rootEl,
      canvasEl,
      ctx,
      bounds: null,
      dragging: false,
      raf: 0
    };
    rootEl.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    closeBtn.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    closeBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.open = false;
      this.onToggleChange(false);
      for (const st of this.states.values()) st.rootEl.hidden = true;
    });
    const panFromEvent = (evt) => {
      if (!state.bounds) return;
      const rect = canvasEl.getBoundingClientRect();
      const px = evt.clientX - rect.left;
      const py = evt.clientY - rect.top;
      const wx = state.bounds.minX + (px - state.bounds.offsetX) / state.bounds.scale;
      const wy = state.bounds.minY + (py - state.bounds.offsetY) / state.bounds.scale;
      panCanvasTo(canvas, wx, wy);
      this.draw(canvas, state);
    };
    canvasEl.addEventListener("pointerdown", (evt) => {
      if (evt.button !== 0) return;
      evt.preventDefault();
      evt.stopPropagation();
      state.dragging = true;
      canvasEl.setPointerCapture?.(evt.pointerId);
      panFromEvent(evt);
    });
    canvasEl.addEventListener("pointermove", (evt) => {
      if (!state.dragging) return;
      evt.preventDefault();
      panFromEvent(evt);
    });
    const endDrag = (evt) => {
      if (!state.dragging) return;
      state.dragging = false;
      try {
        canvasEl.releasePointerCapture?.(evt.pointerId);
      } catch {
      }
    };
    canvasEl.addEventListener("pointerup", endDrag);
    canvasEl.addEventListener("pointercancel", endDrag);
    this.states.set(canvas, state);
    return state;
  }
  scheduleDraw(canvas, state) {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      if (!this.open || !state.rootEl.isConnected) return;
      this.draw(canvas, state);
    });
  }
  draw(canvas, state) {
    const ctx = state.ctx;
    if (!ctx) return;
    const isDark = document.body.classList.contains("theme-dark");
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    const nodes = allNodes(canvas).filter(
      (n) => !n.nodeEl.classList.contains("jce-sec-hidden") && !n.nodeEl.classList.contains("jce-mm-hidden")
    );
    const vp = canvas.getViewportBBox();
    let minX = vp.minX;
    let minY = vp.minY;
    let maxX = vp.maxX;
    let maxY = vp.maxY;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxY - minY);
    const innerW = MAP_W - PAD * 2;
    const innerH = MAP_H - PAD * 2;
    const scale = Math.min(innerW / worldW, innerH / worldH);
    const offsetX = PAD + (innerW - worldW * scale) / 2;
    const offsetY = PAD + (innerH - worldH * scale) / 2;
    state.bounds = { minX, minY, scale, offsetX, offsetY };
    const toX = (wx) => offsetX + (wx - minX) * scale;
    const toY = (wy) => offsetY + (wy - minY) * scale;
    for (const n of nodes) {
      if (!isGroupNode(n)) continue;
      const x = toX(n.x);
      const y = toY(n.y);
      const w = Math.max(3, n.width * scale);
      const h = Math.max(3, n.height * scale);
      ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)";
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.18)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, h, 2);
      ctx.fill();
      ctx.stroke();
    }
    const selected = canvas.selection;
    for (const n of nodes) {
      if (isGroupNode(n)) continue;
      const x = toX(n.x);
      const y = toY(n.y);
      const w = Math.max(3, n.width * scale);
      const h = Math.max(2.5, n.height * scale);
      const bg = cardBgOf(n);
      if (bg) {
        ctx.fillStyle = bg;
      } else if (isMindmap(n)) {
        ctx.fillStyle = isDark ? "rgba(180, 195, 215, 0.45)" : "rgba(110, 125, 145, 0.35)";
      } else if (kindOf(n) === "note") {
        ctx.fillStyle = isDark ? "#35332d" : "#f7f1e3";
      } else {
        ctx.fillStyle = isDark ? "#3a3d42" : "#ffffff";
      }
      const isSel = selected?.has(n);
      ctx.strokeStyle = isSel ? "#4c8bf5" : isDark ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.18)";
      ctx.lineWidth = isSel ? 1.25 : 0.75;
      roundRect(ctx, x, y, w, h, 1.5);
      ctx.fill();
      ctx.stroke();
    }
    const vx = toX(vp.minX);
    const vy = toY(vp.minY);
    const vw = Math.max(8, (vp.maxX - vp.minX) * scale);
    const vh = Math.max(8, (vp.maxY - vp.minY) * scale);
    ctx.fillStyle = "rgba(76, 139, 245, 0.12)";
    ctx.strokeStyle = "rgba(76, 139, 245, 0.85)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, vx, vy, vw, vh, 2.5);
    ctx.fill();
    ctx.stroke();
  }
};
function panCanvasTo(canvas, wx, wy) {
  const z = typeof canvas.zoom === "number" && Number.isFinite(canvas.zoom) ? canvas.zoom : typeof canvas.tZoom === "number" && Number.isFinite(canvas.tZoom) ? canvas.tZoom : 0;
  if (typeof canvas.setViewport === "function") {
    canvas.setViewport(wx, wy, z);
  } else {
    canvas.tx = wx;
    canvas.ty = wy;
    canvas.markViewportChanged?.();
  }
  canvas.requestFrame();
}
function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// src/toolbar.ts
var import_obsidian6 = require("obsidian");

// src/icons.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var ICON_DEFS = {
  select: [
    {
      tag: "path",
      attrs: {
        d: "M5.5 3.8l6 16.2 2.3-6.1 6.1-2.3-14.4-7.8z",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linejoin": "round"
      }
    }
  ],
  connect: [
    {
      tag: "circle",
      attrs: { cx: "6.4", cy: "12", r: "2.1", fill: "none", stroke: "currentColor", "stroke-width": "1.6" }
    },
    {
      tag: "circle",
      attrs: { cx: "17.6", cy: "12", r: "2.1", fill: "none", stroke: "currentColor", "stroke-width": "1.6" }
    },
    {
      tag: "path",
      attrs: { d: "M8.5 12h7", fill: "none", stroke: "currentColor", "stroke-width": "1.6" }
    }
  ],
  note: [
    {
      tag: "rect",
      attrs: {
        x: "4.8",
        y: "4.5",
        width: "14.4",
        height: "15",
        rx: "2.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6"
      }
    },
    {
      tag: "path",
      attrs: {
        d: "M8 9.2h8M8 12.4h8M8 15.6h4.6",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round"
      }
    }
  ],
  text: [
    {
      tag: "path",
      attrs: {
        d: "M6 7.2h12M12 7.2v10.6",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.7",
        "stroke-linecap": "round"
      }
    }
  ],
  mindmap: [
    {
      tag: "rect",
      attrs: {
        x: "8.4",
        y: "3.6",
        width: "7.2",
        height: "4",
        rx: "1.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5"
      }
    },
    {
      tag: "rect",
      attrs: {
        x: "3.4",
        y: "16.4",
        width: "6.4",
        height: "4",
        rx: "1.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5"
      }
    },
    {
      tag: "rect",
      attrs: {
        x: "14.2",
        y: "16.4",
        width: "6.4",
        height: "4",
        rx: "1.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5"
      }
    },
    {
      tag: "path",
      attrs: {
        d: "M12 7.6v4.2M6.6 16.4v-2.2h10.8v2.2M12 11.8v2.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round"
      }
    }
  ],
  todo: [
    {
      tag: "path",
      attrs: {
        d: "M4.2 6.6l1.5 1.5 2.7-3",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      }
    },
    {
      tag: "path",
      attrs: { d: "M11.2 6.4h8.6", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round" }
    },
    {
      tag: "path",
      attrs: {
        d: "M4.2 13.9l1.5 1.5 2.7-3",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      }
    },
    {
      tag: "path",
      attrs: { d: "M11.2 13.7h8.6", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round" }
    },
    {
      tag: "path",
      attrs: {
        d: "M4.2 20.2h15.6",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
        opacity: ".45"
      }
    }
  ],
  section: [
    {
      tag: "rect",
      attrs: {
        x: "3.8",
        y: "5.6",
        width: "16.4",
        height: "12.8",
        rx: "2.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-dasharray": "3.2 2.6"
      }
    }
  ]
};
function renderToolIcon(host, id) {
  const children = ICON_DEFS[id];
  if (!children) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "19");
  svg.setAttribute("height", "19");
  svg.setAttribute("aria-hidden", "true");
  for (const child of children) {
    const el = document.createElementNS(SVG_NS, child.tag);
    for (const [k, v] of Object.entries(child.attrs)) {
      el.setAttribute(k, v);
    }
    svg.appendChild(el);
  }
  host.appendChild(svg);
}

// src/toolbar.ts
var CanvasToolbar = class {
  constructor(onPick, onSearch, onMinimap, onChronos) {
    this.onPick = onPick;
    this.onSearch = onSearch;
    this.onMinimap = onMinimap;
    this.onChronos = onChronos;
    this.current = "select";
    this.el = document.createElement("div");
    this.el.className = "jce-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Canvas Joy");
    const order = ["select", "connect", "note", "text", "todo", "mindmap", "section"];
    order.forEach((id, index) => {
      if (index === 2) {
        this.el.createDiv({ cls: "jce-tool-sep" });
      }
      const meta = TOOLS[id];
      const btn = this.el.createEl("button", {
        type: "button",
        cls: "jce-tool",
        attr: {
          "data-tool": id,
          title: tooltip(meta),
          "aria-label": tooltip(meta)
        }
      });
      renderToolIcon(btn, id);
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.onPick(id);
      });
    });
    this.el.createDiv({ cls: "jce-tool-sep" });
    const searchBtn = this.el.createEl("button", {
      type: "button",
      cls: "jce-tool jce-tool-search",
      attr: {
        "data-tool": "search",
        title: tooltip(SEARCH_TOOL),
        "aria-label": tooltip(SEARCH_TOOL)
      }
    });
    (0, import_obsidian6.setIcon)(searchBtn, "search");
    searchBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
    searchBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.onSearch();
    });
    this.searchBtn = searchBtn;
    const minimapBtn = this.el.createEl("button", {
      type: "button",
      cls: "jce-tool jce-tool-minimap",
      attr: {
        "data-tool": "minimap",
        title: tooltip(MINIMAP_TOOL),
        "aria-label": tooltip(MINIMAP_TOOL)
      }
    });
    (0, import_obsidian6.setIcon)(minimapBtn, "map");
    minimapBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
    minimapBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.onMinimap();
    });
    this.minimapBtn = minimapBtn;
    const chronosBtn = this.el.createEl("button", {
      type: "button",
      cls: "jce-tool jce-tool-chronos",
      attr: {
        "data-tool": "chronos",
        title: tooltip(CHRONOS_TOOL),
        "aria-label": tooltip(CHRONOS_TOOL)
      }
    });
    (0, import_obsidian6.setIcon)(chronosBtn, "hourglass");
    chronosBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
    chronosBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.onChronos();
    });
    this.chronosBtn = chronosBtn;
    this.setActive("select");
  }
  setActive(id) {
    this.current = id;
    this.el.querySelectorAll(".jce-tool").forEach((btn) => {
      if (btn === this.searchBtn || btn === this.minimapBtn || btn === this.chronosBtn) return;
      btn.classList.toggle("is-active", btn.dataset.tool === id);
    });
  }
  setSearchActive(active) {
    this.searchBtn.classList.toggle("is-active", active);
  }
  setMinimapActive(active) {
    this.minimapBtn.classList.toggle("is-active", active);
  }
  setChronosActive(active) {
    this.chronosBtn.classList.toggle("is-active", active);
  }
  getActive() {
    return this.current;
  }
  detach() {
    this.el.remove();
  }
};

// src/menus.ts
var import_obsidian7 = require("obsidian");
var PALETTE = [
  { id: "", label: "\u9ED8\u8BA4 / Default", swatch: "#d8d8d8" },
  { id: "1", label: "\u7EA2 / Red", swatch: "#fb464c" },
  { id: "2", label: "\u6A59 / Orange", swatch: "#e9973f" },
  { id: "3", label: "\u9EC4 / Yellow", swatch: "#e0de71" },
  { id: "4", label: "\u7EFF / Green", swatch: "#44cf6e" },
  { id: "5", label: "\u9752 / Cyan", swatch: "#53c9e1" },
  { id: "6", label: "\u7D2B / Purple", swatch: "#a882ff" }
];
var CREATE_ORDER = ["note", "text", "mindmap", "section"];
var ContextMenus = class {
  constructor(plugin, handlers) {
    this.plugin = plugin;
    this.handlers = handlers;
    this.open = null;
    this.closedAt = 0;
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt) => this.onPointerDown(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "contextmenu",
      (evt) => this.onContextMenu(evt),
      true
    );
  }
  get menuOpen() {
    return !!this.open;
  }
  onPointerDown(evt) {
    const target = evt.target;
    if (this.open) {
      if (target?.closest?.(".menu")) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.hide();
      return;
    }
    if (Date.now() - this.closedAt < 150) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }
  hide() {
    this.open?.hide();
    this.open = null;
    this.closedAt = Date.now();
  }
  onContextMenu(evt) {
    const target = evt.target;
    if (isInsideCanvasUi(target)) return;
    const wrapper = target?.closest?.(".canvas-wrapper");
    if (!(wrapper instanceof HTMLElement)) return;
    const canvas = canvasFromWrapper(this.plugin, wrapper);
    if (!canvas) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.hide();
    const node = nodeFromWrapper(canvas, target);
    const menu = new import_obsidian7.Menu();
    if (node) this.buildObjectMenu(menu, canvas, node);
    else this.buildBlankMenu(menu, canvas, canvas.posFromEvt(evt));
    this.open = menu;
    menu.onHide(() => {
      if (this.open === menu) this.open = null;
      this.closedAt = Date.now();
    });
    menu.showAtMouseEvent(evt);
  }
  buildBlankMenu(menu, canvas, at) {
    for (const kind of CREATE_ORDER) {
      const meta = TOOLS[kind];
      menu.addItem(
        (item) => item.setTitle(menuLabel(meta)).setIcon(ICON_FOR[kind]).onClick(() => this.handlers.create(canvas, kind, at))
      );
    }
  }
  buildObjectMenu(menu, canvas, node) {
    menu.addItem((item) => {
      item.setTitle(menuLabel(MENU.color)).setIcon("palette");
      const sub = item.setSubmenu?.();
      const target = sub ?? menu;
      for (const color of PALETTE) {
        target.addItem(
          (row) => row.setTitle(color.label).setChecked((node.color ?? "") === color.id).onClick(() => this.handlers.setColor(canvas, node.id, color.id))
        );
      }
    });
    if (kindOf(node) === "note") {
      menu.addItem((item) => {
        item.setTitle(menuLabel(MENU.cardBg)).setIcon("paint-bucket");
        const sub = item.setSubmenu?.();
        const target = sub ?? menu;
        const current = cardBgOf(node);
        for (const bg of CARD_BG_PALETTE) {
          target.addItem(
            (row) => row.setTitle(menuLabel(bg)).setChecked(current === bg.value).onClick(() => this.handlers.setCardBg(canvas, node.id, bg.value))
          );
        }
      });
    }
    if (isCollapsible(node)) {
      const folded = isCardFolded(node);
      const item = folded ? MENU.expandCard : MENU.collapseCard;
      menu.addItem(
        (row) => row.setTitle(menuLabel(item)).setIcon(folded ? "chevrons-down-up" : "chevrons-up-down").onClick(() => this.handlers.toggleCardFold(canvas, node.id))
      );
    }
    const focused = this.handlers.isFocused(canvas);
    menu.addItem(
      (row) => row.setTitle(menuLabel(focused ? MENU.unfocus : MENU.focus)).setIcon("eye").onClick(() => {
        if (focused) this.handlers.unfocus(canvas);
        else this.handlers.focus(canvas, node);
      })
    );
    const sel = selectedNodes(canvas);
    if (sel.length >= 2) {
      menu.addItem((item) => {
        item.setTitle(menuLabel(MENU.align)).setIcon("align-start-vertical");
        const sub = item.setSubmenu?.();
        const target = sub ?? menu;
        const ops = sel.length >= 3 ? ["left", "centerX", "right", "top", "centerY", "bottom", "distX", "distY"] : ["left", "centerX", "right", "top", "centerY", "bottom"];
        for (const op of ops) {
          target.addItem(
            (row) => row.setTitle(menuLabel(ALIGN_OPS[op])).onClick(() => this.handlers.alignSelection(canvas, op))
          );
        }
      });
    }
    if (sel.length > 1 || !isGroupNode(node)) {
      menu.addItem(
        (row) => row.setTitle(menuLabel(MENU.groupSection)).setIcon("frame").onClick(() => this.handlers.groupSelection(canvas, node))
      );
    }
    if (!isGroupNode(node)) {
      menu.addItem(
        (row) => row.setTitle(menuLabel(MENU.chronosFocus)).setIcon("hourglass").onClick(() => this.handlers.chronosFocusNode(canvas, node))
      );
      menu.addItem(
        (row) => row.setTitle(menuLabel(MENU.setTime)).setIcon("calendar").onClick(() => this.handlers.setCardTime(canvas, node))
      );
    }
    menu.addItem(
      (item) => item.setTitle(menuLabel(MENU.remove)).setIcon("trash").onClick(() => this.handlers.remove(canvas, node.id))
    );
    if (isMindmap(node)) {
      if (hasChildren(canvas, node.id)) {
        const folded = isFolded(canvas, node.id);
        const item = folded ? MENU.unfold : MENU.fold;
        menu.addItem(
          (row) => row.setTitle(menuLabel(item)).setIcon(folded ? "chevrons-down-up" : "chevrons-up-down").onClick(() => this.handlers.setFolded(canvas, node.id, !folded))
        );
      }
      menu.addItem(
        (row) => row.setTitle(menuLabel(MENU.rotate)).setIcon("rotate-cw").onClick(() => this.handlers.rotate(canvas, node.id))
      );
    }
  }
};
var ICON_FOR = {
  note: "sticky-note",
  text: "type",
  mindmap: "network",
  section: "frame"
};
function canvasFromWrapper(plugin, wrapper) {
  for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
    const view = leaf.view;
    if (view.canvas?.wrapperEl === wrapper) return view.canvas;
  }
  const active = plugin.app.workspace.getActiveViewOfType(import_obsidian7.FileView);
  if (active && active.getViewType() === "canvas") {
    return active.canvas ?? null;
  }
  return null;
}
function nodeFromWrapper(canvas, target) {
  const el = target?.closest?.(".canvas-node");
  if (!(el instanceof HTMLElement)) return null;
  for (const node of canvas.nodes.values()) {
    if (node.nodeEl === el || node.nodeEl.contains(el) || el.contains(node.nodeEl)) return node;
  }
  return null;
}

// src/mindmap.ts
var import_obsidian8 = require("obsidian");

// src/objects.ts
var import_view2 = require("@codemirror/view");
function createObject(chrome, opts) {
  const { canvas, kind } = opts;
  const size = KIND_SIZE[kind];
  const pos = opts.at ? { x: Math.round(opts.at.x - size.width / 2), y: Math.round(opts.at.y - size.height / 2) } : viewportCenter(canvas, size);
  let node;
  if (kind === "section") {
    node = canvas.createGroupNode({
      pos,
      size,
      label: DEFAULTS.section,
      focus: false,
      save: true
    });
    if (node) tag(canvas, node, "section");
  } else {
    const text = opts.text ?? (kind === "note" ? `# ${DEFAULTS.noteCard}
` : kind === "mindmap" ? DEFAULTS.mindmapRoot : DEFAULTS.text);
    node = canvas.createTextNode({ pos, size, text, focus: false, save: true });
    if (node) {
      tag(canvas, node, kind);
      if (kind === "mindmap") {
        node.setData({ ...node.getData(), [ROOT]: node.id, [LAYOUT]: "TB" });
        canvas.requestSave();
      }
    }
  }
  if (!node) return void 0;
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
function tag(canvas, node, kind) {
  node.setData({ ...node.getData(), [TAG]: kind });
  canvas.requestSave();
}
function startEditingWhenReady(canvas, node, tries = 0) {
  const el = node.nodeEl;
  if (!el?.isConnected) {
    if (tries > 20) return;
    canvas.requestFrame();
    requestAnimationFrame(() => startEditingWhenReady(canvas, node, tries + 1));
    return;
  }
  if (!node.isEditing) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      canvas.wrapperEl.focus?.();
    }
    const lazyNode = node;
    if (tries > 0) {
      lazyNode.attach?.();
      lazyNode.render?.();
    }
    canvas.selectOnly(node);
    node.startEditing?.();
  }
  if (tries < 30) {
    canvas.requestFrame();
    requestAnimationFrame(() => {
      const live = canvas.nodes.get(node.id) ?? node;
      if (!live.isEditing) startEditingWhenReady(canvas, live, tries + 1);
    });
  }
}
function keepCaretAtEnd(canvas, node, expected) {
  for (const delay of [250, 600, 1e3, 1400]) {
    window.setTimeout(() => {
      const live = canvas.nodes.get(node.id);
      if (!live?.isEditing) return;
      const view = cmView(live);
      if (!view || view.state.doc.toString() !== expected) return;
      placeCaretAtEnd(live);
    }, delay);
  }
}
function cmView(node) {
  const content = node.nodeEl?.querySelector("iframe")?.contentDocument?.querySelector(".cm-content");
  if (!(content instanceof HTMLElement)) return null;
  try {
    return import_view2.EditorView.findFromDOM(content);
  } catch {
    return null;
  }
}
function placeCaretAtEnd(node) {
  const frame = node.nodeEl?.querySelector("iframe");
  const doc = frame?.contentDocument;
  const content = doc?.querySelector(".cm-content");
  if (!(content instanceof HTMLElement)) return false;
  const view = import_view2.EditorView.findFromDOM(content);
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

// src/mindmap.ts
var SIDES = {
  TB: { from: "bottom", to: "top" },
  BT: { from: "top", to: "bottom" },
  LR: { from: "right", to: "left" },
  RL: { from: "left", to: "right" }
};
var MindmapController = class {
  constructor(plugin, chrome) {
    this.plugin = plugin;
    this.chrome = chrome;
    this.drag = null;
    this.installPointerDrag();
  }
  // ---------------------------------------------------------------- children
  /** PRD MM-03..MM-06: create a real child node, keep existing siblings put,
   *  inherit size, and wire the parent→child arrow before editing starts. */
  addChild(canvas, parentId) {
    const parent = canvas.nodes.get(parentId);
    if (!parent || !isMindmap(parent)) return void 0;
    const rootId = rootIdOf(parent) ?? parent.id;
    const tree = treeOf(canvas, rootId);
    const layout = tree.layout;
    const siblings = childrenOf(canvas, parentId);
    const size = inheritedSize(parent, siblings.map((s) => ({ width: s.width, height: s.height })));
    const pos = childPosition(parent, siblings, size, layout);
    const child = canvas.createTextNode({ pos, size, text: "", focus: false, save: true });
    if (!child) return void 0;
    child.setData({ ...child.getData(), [TAG]: "mindmap", [ROOT]: rootId });
    if (dataOf(parent).jceFold === true) {
      parent.setData({ ...parent.getData(), jceFold: false });
    }
    createEdge(canvas, parent, child, SIDES[layout]);
    commit(canvas);
    this.chrome.invalidate(canvas);
    startEditingWhenReady(canvas, child);
    return child;
  }
  // -------------------------------------------------------------------- fold
  setFolded(canvas, nodeId, folded) {
    const node = canvas.nodes.get(nodeId);
    if (!node) return;
    node.setData({ ...node.getData(), jceFold: folded });
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }
  folded(canvas, nodeId) {
    return isFolded(canvas, nodeId);
  }
  // ------------------------------------------------------------------ rotate
  /**
   * Rotate the branch direction by 90° clockwise (TB → LR → BT → RL).
   * PRD MM-10 requires a Rotate action but leaves direction/step open; this is
   * a documented proposal, not a confirmed user decision.
   */
  rotate(canvas, nodeId) {
    const node = canvas.nodes.get(nodeId);
    if (!node || !isMindmap(node)) return;
    const rootId = rootIdOf(node) ?? node.id;
    const root = canvas.nodes.get(rootId);
    if (!root) return;
    const layout = nextLayout(dataOf(root)[LAYOUT] ?? "TB");
    root.setData({ ...root.getData(), [LAYOUT]: layout });
    this.relayout(canvas, root, layout);
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }
  /** Re-place descendants of `root` for a new orientation; root itself stays. */
  relayout(canvas, root, layout) {
    const walk = (parent) => {
      const kids = childrenOf(canvas, parent.id);
      const placed = [];
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
  installPointerDrag() {
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt) => this.onPointerDown(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointermove",
      (evt) => {
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
  onPointerDown(evt) {
    this.drag = null;
    if (evt.button !== 0) return;
    if (evt.shiftKey || evt.metaKey || evt.ctrlKey || evt.altKey) return;
    const view = activeCanvasView(this.plugin);
    if (!view) return;
    const canvas = view;
    if (isInsideCanvasUi(evt.target)) return;
    const node = nodeFromEvent(canvas, evt);
    if (!node || !isMindmap(node)) return;
    if (isEditing(node)) return;
    const rootId = rootIdOf(node) ?? node.id;
    const tree = treeOf(canvas, rootId);
    const subtree = [node.id, ...collectDescendants(tree, node.id)];
    if (subtree.length < 2) return;
    canvas.deselectAll();
    for (const id of subtree) {
      const member = canvas.nodes.get(id);
      if (member) canvas.select(member);
    }
    this.drag = { canvas, nodeId: node.id, moved: false, x: evt.clientX, y: evt.clientY };
  }
  onPointerUp() {
    const drag = this.drag;
    this.drag = null;
    if (!drag || !drag.moved) {
      const node = drag?.canvas.nodes.get(drag.nodeId);
      if (node) {
        drag.canvas.deselectAll();
        drag.canvas.selectOnly(node);
      }
    }
    if (drag) this.chrome.schedule(drag.canvas);
  }
  // ------------------------------------------------------------------ create
  /** Wrap an existing plain canvas text node into a mindmap root. */
  adoptAsRoot(canvas, node) {
    node.setData({ ...node.getData(), [TAG]: "mindmap", [ROOT]: node.id, [LAYOUT]: "TB" });
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }
  rootIds(canvas) {
    return rootIds(canvas);
  }
  /** The mindmap node currently selected or being edited, if any. */
  activeNode(canvas) {
    const selected = selectedNodes(canvas).filter((n) => kindOf(n) === "mindmap");
    if (selected.length === 1) return selected[0];
    for (const node of canvas.nodes.values()) {
      if (isEditing(node) && isMindmap(node)) return node;
    }
    return void 0;
  }
  isRoot(canvas, nodeId) {
    const node = canvas.nodes.get(nodeId);
    return !!node && isMindmap(node) && rootIdOf(node) === nodeId;
  }
  static defaultSize() {
    return KIND_SIZE.mindmap;
  }
};
function collectDescendants(tree, id) {
  const out = [];
  const walk = (current) => {
    for (const child of tree.children.get(current) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}
function activeCanvasView(plugin) {
  const view = plugin.app.workspace.getActiveViewOfType(import_obsidian8.FileView);
  if (!view || view.getViewType() !== "canvas") return null;
  return view.canvas ?? null;
}

// src/search.ts
var import_obsidian9 = require("obsidian");
var CanvasSearchBar = class {
  constructor(opts = {}) {
    this.opts = opts;
    this.states = /* @__PURE__ */ new Map();
  }
  isOpen(canvas) {
    return this.states.get(canvas)?.open === true;
  }
  toggle(canvas) {
    if (this.isOpen(canvas)) this.close(canvas);
    else this.open(canvas);
  }
  open(canvas) {
    const state = this.ensureState(canvas);
    if (!state) return;
    state.open = true;
    state.barEl.hidden = false;
    this.opts.onOpenChange?.(canvas, true);
    this.runSearch(canvas, state, false);
    window.requestAnimationFrame(() => {
      state.inputEl.focus();
      state.inputEl.select();
    });
  }
  close(canvas) {
    const state = this.states.get(canvas);
    if (!state || !state.open) return;
    state.open = false;
    state.barEl.hidden = true;
    this.clearHighlights(canvas);
    this.opts.onOpenChange?.(canvas, false);
  }
  detach(canvas) {
    const state = this.states.get(canvas);
    if (!state) return;
    this.clearHighlights(canvas);
    state.barEl.remove();
    this.states.delete(canvas);
  }
  destroy() {
    for (const canvas of Array.from(this.states.keys())) {
      this.detach(canvas);
    }
  }
  ensureState(canvas) {
    const existing = this.states.get(canvas);
    if (existing && existing.barEl.isConnected) return existing;
    existing?.barEl.remove();
    const host = canvas.wrapperEl.closest(".view-content");
    if (!host) return null;
    const barEl = host.createDiv({ cls: "jce-search-bar" });
    barEl.hidden = true;
    const row = barEl.createDiv({ cls: "jce-search-row" });
    const icon = row.createSpan({ cls: "jce-search-icon" });
    (0, import_obsidian9.setIcon)(icon, "search");
    const inputEl = row.createEl("input", {
      type: "text",
      cls: "jce-search-input",
      attr: { placeholder: "\u641C\u7D22\u5F53\u524D\u753B\u5E03\u2026 / Search canvas" }
    });
    const countEl = row.createSpan({ cls: "jce-search-count", text: "0/0" });
    const prevBtn = row.createEl("button", {
      type: "button",
      cls: "jce-search-nav",
      attr: { title: "\u4E0A\u4E00\u4E2A / Previous (Shift+Enter)", "aria-label": "Previous" }
    });
    (0, import_obsidian9.setIcon)(prevBtn, "chevron-up");
    const nextBtn = row.createEl("button", {
      type: "button",
      cls: "jce-search-nav",
      attr: { title: "\u4E0B\u4E00\u4E2A / Next (Enter)", "aria-label": "Next" }
    });
    (0, import_obsidian9.setIcon)(nextBtn, "chevron-down");
    const closeBtn = row.createEl("button", {
      type: "button",
      cls: "jce-search-close",
      attr: { title: "\u5173\u95ED / Close (Esc)", "aria-label": "Close" }
    });
    (0, import_obsidian9.setIcon)(closeBtn, "x");
    const listEl = barEl.createDiv({ cls: "jce-search-list" });
    listEl.hidden = true;
    const state = {
      barEl,
      inputEl,
      countEl,
      listEl,
      hits: [],
      index: -1,
      open: false
    };
    barEl.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    inputEl.addEventListener("input", () => this.runSearch(canvas, state, true));
    inputEl.addEventListener("keydown", (evt) => {
      if (evt.isComposing) return;
      if (evt.key === "Escape") {
        evt.preventDefault();
        evt.stopPropagation();
        this.close(canvas);
        canvas.wrapperEl.focus?.();
        return;
      }
      if (evt.key === "Enter") {
        evt.preventDefault();
        evt.stopPropagation();
        this.step(canvas, state, evt.shiftKey ? -1 : 1);
        return;
      }
      if (evt.key === "ArrowDown") {
        evt.preventDefault();
        this.step(canvas, state, 1);
        return;
      }
      if (evt.key === "ArrowUp") {
        evt.preventDefault();
        this.step(canvas, state, -1);
      }
    });
    prevBtn.addEventListener("click", () => this.step(canvas, state, -1));
    nextBtn.addEventListener("click", () => this.step(canvas, state, 1));
    closeBtn.addEventListener("click", () => this.close(canvas));
    this.states.set(canvas, state);
    return state;
  }
  runSearch(canvas, state, jumpToFirst) {
    const query = state.inputEl.value.trim().toLowerCase();
    this.clearHighlights(canvas);
    if (!query) {
      state.hits = [];
      state.index = -1;
      state.countEl.textContent = "0/0";
      state.listEl.hidden = true;
      state.listEl.empty();
      return;
    }
    const hits = [];
    for (const node of canvas.nodes.values()) {
      const title = nodeTitleOf(node);
      const raw = nodeTextContent(node);
      const hay = `${title}
${raw}`.toLowerCase();
      const pos = hay.indexOf(query);
      if (pos === -1) continue;
      const rawFlat = raw.replace(/\s+/g, " ").trim();
      const rawPos = rawFlat.toLowerCase().indexOf(query);
      let snippet = "";
      if (rawPos !== -1) {
        const start = Math.max(0, rawPos - 18);
        const end = Math.min(rawFlat.length, rawPos + query.length + 34);
        snippet = (start > 0 ? "\u2026" : "") + rawFlat.slice(start, end) + (end < rawFlat.length ? "\u2026" : "");
      }
      hits.push({
        node,
        title,
        snippet,
        kindLabel: kindBadge(node)
      });
    }
    hits.sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);
    state.hits = hits;
    state.index = hits.length > 0 ? 0 : -1;
    for (const hit of hits) {
      hit.node.nodeEl?.classList.add("jce-search-hit");
    }
    this.renderList(canvas, state);
    if (hits.length > 0 && jumpToFirst) {
      this.activateHit(canvas, state, 0);
    } else {
      this.updateCount(state);
    }
  }
  step(canvas, state, delta) {
    if (!state.hits.length) return;
    const len = state.hits.length;
    const next = state.index < 0 ? 0 : (state.index + delta + len) % len;
    this.activateHit(canvas, state, next);
  }
  activateHit(canvas, state, index) {
    const hit = state.hits[index];
    if (!hit) return;
    for (const h of state.hits) h.node.nodeEl?.classList.remove("jce-search-current");
    state.index = index;
    this.updateCount(state);
    this.opts.onRevealNode?.(canvas, hit.node.id);
    hit.node.nodeEl?.classList.add("jce-search-hit", "jce-search-current");
    canvas.selectOnly(hit.node);
    focusNodeInViewport(canvas, hit.node);
    const rows = state.listEl.querySelectorAll(".jce-search-item");
    rows.forEach((row, i) => {
      const active = i === index;
      row.classList.toggle("is-active", active);
      if (active) row.scrollIntoView({ block: "nearest" });
    });
  }
  updateCount(state) {
    if (!state.hits.length) {
      state.countEl.textContent = "0/0";
      return;
    }
    state.countEl.textContent = `${state.index + 1}/${state.hits.length}`;
  }
  renderList(canvas, state) {
    state.listEl.empty();
    if (!state.hits.length) {
      state.listEl.hidden = true;
      return;
    }
    state.listEl.hidden = false;
    state.hits.forEach((hit, i) => {
      const item = state.listEl.createEl("button", {
        type: "button",
        cls: "jce-search-item"
      });
      item.toggleClass("is-active", i === state.index);
      item.createSpan({ cls: "jce-search-badge", text: hit.kindLabel });
      const body = item.createSpan({ cls: "jce-search-item-body" });
      body.createSpan({ cls: "jce-search-item-title", text: hit.title });
      if (hit.snippet && hit.snippet !== hit.title) {
        body.createSpan({ cls: "jce-search-item-sub", text: hit.snippet });
      }
      item.addEventListener("mousedown", (evt) => evt.preventDefault());
      item.addEventListener("click", () => this.activateHit(canvas, state, i));
    });
  }
  clearHighlights(canvas) {
    for (const node of canvas.nodes.values()) {
      node.nodeEl?.classList.remove("jce-search-hit", "jce-search-current");
    }
  }
};
function kindBadge(node) {
  const kind = kindOf(node);
  if (kind === "note") return "\u7B14\u8BB0";
  if (kind === "text") return "\u6587\u5B57";
  if (kind === "mindmap") return "\u5BFC\u56FE";
  if (isGroupNode(node)) return "\u5206\u533A";
  if (node.getData().type === "file") return "\u6587\u4EF6";
  return "\u5361\u7247";
}

// src/todo.ts
var import_view3 = require("@codemirror/view");
var TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;
var TodoController = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  /**
   * Window-level capture: Obsidian's canvas selects the node on pointerdown
   * before a preview checkbox could react, so the check has to be intercepted
   * first and the event stopped.
   */
  onPointerDown(evt) {
    const hit = this.hit(evt);
    if (!hit) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.toggle(hit.canvas, hit.node, hit.index);
  }
  /** The reading-view checkbox writes back through a click handler; without
   *  this it re-saves the stale line right after our toggle. */
  onClick(evt) {
    if (!this.hit(evt)) return;
    evt.preventDefault();
    evt.stopPropagation();
  }
  /** `[ ]`/`[]` + space at the start of a line becomes a task item. */
  onKeyDown(evt, doc) {
    if (evt.key !== " " || evt.metaKey || evt.ctrlKey || evt.altKey || evt.isComposing) return false;
    const content = doc.querySelector(".cm-content");
    if (!(content instanceof HTMLElement)) return false;
    const view = findView2(content);
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
      selection: { anchor: line.from + insert.length }
    });
    return true;
  }
  hit(evt) {
    if (evt instanceof MouseEvent && evt.button !== 0) return null;
    const target = evt.target;
    let input = target instanceof HTMLInputElement && target.classList.contains("task-list-item-checkbox") ? target : null;
    if (!input) {
      if (!target?.classList?.contains("canvas-node-content-blocker") || !(evt instanceof MouseEvent)) return null;
      const found = document.elementsFromPoint(evt.clientX, evt.clientY).find(
        (el) => el instanceof HTMLInputElement && el.classList.contains("task-list-item-checkbox")
      );
      input = found ?? null;
    }
    if (!input || input.type !== "checkbox") return null;
    if (!input.closest(".markdown-preview-view") || input.closest(".cm-editor")) return null;
    const wrapper = input.closest(".canvas-wrapper");
    if (!(wrapper instanceof HTMLElement)) return null;
    const canvas = this.canvasFor(wrapper);
    if (!canvas) return null;
    const node = this.nodeFor(canvas, input);
    if (!node) return null;
    if (node.getData().type !== "text") return null;
    const item = input.closest("li.task-list-item");
    const items = Array.from(node.nodeEl.querySelectorAll("li.task-list-item"));
    const index = item ? items.indexOf(item) : -1;
    if (index < 0) return null;
    return { canvas, node, index };
  }
  toggle(canvas, node, taskIndex) {
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
  canvasFor(wrapper) {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
      const canvas = leaf.view.canvas;
      if (canvas?.wrapperEl === wrapper) return canvas;
    }
    return null;
  }
  nodeFor(canvas, target) {
    const el = target.closest(".canvas-node");
    if (!(el instanceof HTMLElement)) return null;
    for (const node of canvas.nodes.values()) {
      if (node.nodeEl === el || node.nodeEl.contains(el)) return node;
    }
    return null;
  }
};
function findView2(el) {
  try {
    const view = import_view3.EditorView.findFromDOM(el);
    if (view && view.state?.selection) return view;
  } catch {
  }
  return null;
}

// src/zoomlod.ts
var FAR_SCALE = 0.32;
var ZoomLodController = class {
  constructor() {
    this.lastScale = /* @__PURE__ */ new WeakMap();
  }
  sync(canvas) {
    const scale = scaleOf(canvas);
    const prev = this.lastScale.get(canvas);
    if (prev === void 0 || Math.abs(scale - prev) > 4e-3) {
      this.lastScale.set(canvas, scale);
      canvas.wrapperEl.setCssProps({ "--jce-scale": scale.toFixed(3) });
    }
    const nativeZoomOut = canvas.wrapperEl.classList.contains("mod-zoomed-out");
    const isFar = nativeZoomOut || scale <= FAR_SCALE;
    canvas.wrapperEl.toggleClass("jce-zoom-far", isFar);
    for (const node of allNodes(canvas)) {
      const host = node.containerEl;
      if (!host) continue;
      let overlay = host.querySelector(":scope > .jce-lod-overlay");
      const skip = !isFar || isMindmap(node) || isGroupNode(node) || isCardFolded(node) || isEditing(node) || node.nodeEl.classList.contains("jce-sec-hidden");
      if (skip) {
        if (overlay) overlay.hidden = true;
        continue;
      }
      const title = nodeTitleOf(node);
      const todo = todoProgressOf(nodeTextContent(node));
      const badge = todo ? `\u2713 ${todo.done}/${todo.total}` : "";
      const compact = node.height < 115;
      const sig = `${title}
${badge}
${compact ? "C" : ""}`;
      if (!overlay) {
        overlay = host.createDiv({ cls: "jce-lod-overlay" });
        overlay.createDiv({ cls: "jce-lod-title" });
        overlay.createDiv({ cls: "jce-lod-badge" });
      }
      overlay.hidden = false;
      overlay.toggleClass("is-compact", compact);
      if (overlay.dataset.sig !== sig) {
        overlay.dataset.sig = sig;
        const titleEl = overlay.querySelector(".jce-lod-title");
        const badgeEl = overlay.querySelector(".jce-lod-badge");
        if (titleEl) titleEl.textContent = title;
        if (badgeEl) {
          badgeEl.textContent = badge;
          badgeEl.hidden = !badge;
        }
      }
    }
  }
  detach(canvas) {
    this.lastScale.delete(canvas);
    canvas.wrapperEl.classList.remove("jce-zoom-far");
    canvas.wrapperEl.setCssProps({ "--jce-scale": "" });
    for (const node of allNodes(canvas)) {
      node.nodeEl.querySelector(".jce-lod-overlay")?.remove();
    }
  }
};

// src/main.ts
var TOOL_KEYS = {
  v: "select",
  c: "connect",
  n: "note",
  t: "text",
  m: "mindmap",
  g: "section",
  d: "todo"
};
var CanvasEnhancePlugin = class extends import_obsidian10.Plugin {
  constructor() {
    super(...arguments);
    this.keyScope = null;
    this.prefs = {};
    this.toolbars = /* @__PURE__ */ new Map();
    this.placing = null;
    this.blankDown = null;
    this.hookedDocs = /* @__PURE__ */ new WeakSet();
    this.frameHooks = /* @__PURE__ */ new WeakSet();
  }
  async onload() {
    this.prefs = await this.loadData() ?? {};
    this.collapse = new CardCollapseController();
    this.zoomLod = new ZoomLodController();
    this.focus = new FocusController();
    this.align = new AlignBar({
      onAlign: (canvas, op) => this.alignSelection(canvas, op),
      isSuppressed: (canvas) => this.search.isOpen(canvas) || this.focus.isActive(canvas)
    });
    this.minimap = new MinimapController(this.prefs.minimapOpen === true, (open) => {
      this.prefs.minimapOpen = open;
      void this.saveData(this.prefs);
      for (const bar of this.toolbars.values()) bar.setMinimapActive(open);
    });
    this.search = new CanvasSearchBar({
      onRevealNode: (canvas, nodeId) => {
        this.collapse.expandContainingGroup(canvas, nodeId);
        this.chrome.invalidate(canvas);
      },
      onOpenChange: (canvas, open) => {
        this.toolbars.get(canvas)?.setSearchActive(open);
        this.align.sync(canvas);
      }
    });
    this.chrome = new Chrome(this, (canvas) => {
      this.hookFrames(canvas);
      this.collapse.sync(canvas);
      this.zoomLod.sync(canvas);
      this.focus.sync(canvas);
      this.align.sync(canvas);
      this.minimap.sync(canvas);
      this.anchors.syncHandles(canvas);
      this.chronos.sync(canvas);
    });
    this.mindmap = new MindmapController(this, this.chrome);
    this.formats = new FormatBar(this);
    this.todo = new TodoController(this);
    this.connect = new ConnectTool(this);
    this.anchors = new EdgeAnchorsController(this);
    this.chronos = new ChronosController(this, {
      onActiveChange: (canvas, active) => {
        this.toolbars.get(canvas)?.setChronosActive(active);
      }
    });
    this.menus = new ContextMenus(this, {
      create: (canvas, kind, at) => {
        createObject(this.chrome, { canvas, kind, at });
        this.setPlacing(null);
        this.setActive(canvas, "select");
      },
      remove: (canvas, nodeId) => this.removeNode(canvas, nodeId),
      setColor: (canvas, nodeId, color) => this.setColor(canvas, nodeId, color),
      setCardBg: (canvas, nodeId, color) => this.setCardBg(canvas, nodeId, color),
      rotate: (canvas, nodeId) => this.mindmap.rotate(canvas, nodeId),
      setFolded: (canvas, nodeId, folded) => this.mindmap.setFolded(canvas, nodeId, folded),
      focus: (canvas, node) => {
        const sel = selectedNodes(canvas);
        const targets = sel.some((n) => n.id === node.id) ? sel : [node];
        this.focus.enter(canvas, targets);
        this.align.sync(canvas);
      },
      unfocus: (canvas) => {
        this.focus.exit(canvas);
        this.align.sync(canvas);
      },
      isFocused: (canvas) => this.focus.isActive(canvas),
      groupSelection: (canvas, fallbackNode) => this.groupSelection(canvas, fallbackNode),
      alignSelection: (canvas, op) => this.alignSelection(canvas, op),
      toggleCardFold: (canvas, nodeId) => {
        this.collapse.toggle(canvas, nodeId);
        this.chrome.invalidate(canvas);
      },
      setCardTime: (canvas, node) => {
        this.chronos.openSetTimeModal(canvas, node);
      },
      chronosFocusNode: (canvas, node) => {
        this.chronos.focusNode(canvas, node);
      }
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.sync()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.sync()));
    this.registerEvent(this.app.workspace.on("file-open", () => window.setTimeout(() => this.sync(), 60)));
    this.registerDomEvent(window, "keydown", (evt) => this.onKey(evt), true);
    const scope = new import_obsidian10.Scope(this.app.scope);
    scope.register(["Mod"], "g", (evt) => {
      const canvas = activeCanvas(this.app);
      if (!canvas || isTyping(evt.target)) return;
      this.groupSelection(canvas);
      this.setActive(canvas, "select");
      return false;
    });
    scope.register(["Mod"], "f", (evt) => {
      const canvas = activeCanvas(this.app);
      if (!canvas || isTyping(evt.target)) return;
      this.search.open(canvas);
      return false;
    });
    this.app.keymap.pushScope(scope);
    this.keyScope = scope;
    this.registerDomEvent(window, "pointerdown", (evt) => this.todo.onPointerDown(evt), true);
    this.registerDomEvent(window, "click", (evt) => this.todo.onClick(evt), true);
    this.registerDomEvent(document, "pointermove", (evt) => this.onPointerMove(evt), true);
    this.registerDomEvent(
      document,
      "pointerdown",
      (evt) => {
        if (this.placing) {
          this.onPlaceClick(evt);
        } else if (evt.button === 0) {
          const canvas = activeCanvas(this.app);
          const target = evt.target;
          if (canvas && this.focus.isActive(canvas) && target && canvas.wrapperEl.contains(target) && !target.closest(".canvas-node") && !isInsideCanvasUi(target)) {
            this.blankDown = { canvas, x: evt.clientX, y: evt.clientY };
          } else {
            this.blankDown = null;
          }
        }
        this.syncSelectionChrome();
      },
      true
    );
    this.registerDomEvent(
      document,
      "pointerup",
      (evt) => {
        if (this.blankDown) {
          const down = this.blankDown;
          this.blankDown = null;
          if (Math.hypot(evt.clientX - down.x, evt.clientY - down.y) < 6) {
            this.focus.onCanvasBlankClick(down.canvas);
          }
        }
        this.syncSelectionChrome();
      },
      true
    );
    this.addCommand({
      id: "create-section",
      name: "\u65B0\u5EFA\u5206\u533A / Create section",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.groupSelection(canvas);
        return true;
      }
    });
    this.addCommand({
      id: "search-canvas",
      name: "\u753B\u5E03\u5185\u641C\u7D22 / Search in canvas",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.search.open(canvas);
        return true;
      }
    });
    this.addCommand({
      id: "toggle-focus-mode",
      name: "\u5207\u6362\u805A\u7126\u6A21\u5F0F / Toggle focus mode",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!this.focus.isActive(canvas) && !selectedNodes(canvas).length) return false;
        if (!checking) this.focus.toggle(canvas);
        return true;
      }
    });
    this.addCommand({
      id: "group-selection-into-section",
      name: "\u6846\u9009\u6253\u5305\u8FDB\u5206\u533A / Group selection into section",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.groupSelection(canvas);
        return true;
      }
    });
    this.addCommand({
      id: "toggle-minimap",
      name: "\u5207\u6362\u5C0F\u5730\u56FE / Toggle minimap",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.minimap.toggle(this.toolbars.keys());
        return true;
      }
    });
    this.addCommand({
      id: "toggle-chronos",
      name: "\u5207\u6362\u65F6\u95F4\u8F74 / Toggle Chronos timeline",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.chronos.toggle(canvas);
        return true;
      }
    });
    this.addCommand({
      id: "add-mindmap-child",
      name: "\u65B0\u5EFA\u5BFC\u56FE\u5B50\u8282\u70B9 / Add mindmap child",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        const node = this.activeMindmapNode(canvas);
        if (!node) return false;
        if (!checking) this.mindmap.addChild(canvas, node.id);
        return true;
      }
    });
    this.sync();
  }
  onunload() {
    if (this.keyScope) {
      this.app.keymap.popScope(this.keyScope);
      this.keyScope = null;
    }
    this.setPlacing(null);
    this.blankDown = null;
    this.connect.exit();
    this.formats.hide();
    this.search.destroy();
    this.focus.destroy();
    this.align.destroy();
    this.minimap.destroy();
    this.anchors.destroy();
    this.chronos.destroy();
    for (const canvas of this.toolbars.keys()) {
      this.collapse.detach(canvas);
      this.zoomLod.detach(canvas);
      this.anchors.detach(canvas);
      this.chronos.detach(canvas);
      this.chrome.detach(canvas);
    }
    for (const bar of this.toolbars.values()) bar.detach();
    this.toolbars.clear();
  }
  // ------------------------------------------------------------- lifecycle
  sync() {
    const seen = /* @__PURE__ */ new Set();
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      const canvas = canvasOf(leaf);
      if (!canvas || seen.has(canvas)) continue;
      seen.add(canvas);
      this.chrome.attach(canvas);
      this.anchors.attach(canvas);
      this.ensureToolbar(leaf, canvas);
      this.hookFrames(canvas);
      this.patchFrame(canvas);
    }
    for (const [canvas, bar] of Array.from(this.toolbars)) {
      if (seen.has(canvas)) continue;
      bar.detach();
      this.search.detach(canvas);
      this.focus.detach(canvas);
      this.align.detach(canvas);
      this.minimap.detach(canvas);
      this.collapse.detach(canvas);
      this.zoomLod.detach(canvas);
      this.anchors.detach(canvas);
      this.chronos.detach(canvas);
      this.chrome.detach(canvas);
      this.toolbars.delete(canvas);
    }
  }
  ensureToolbar(leaf, canvas) {
    const host = leaf.view.contentEl;
    if (!host) return;
    const existing = this.toolbars.get(canvas);
    if (existing && host.contains(existing.el)) return;
    existing?.detach();
    const bar = new CanvasToolbar(
      (tool) => this.onTool(canvas, tool),
      () => this.search.toggle(canvas),
      () => this.minimap.toggle(this.toolbars.keys()),
      () => this.chronos.toggle(canvas)
    );
    bar.setMinimapActive(this.minimap.isOpen());
    bar.setChronosActive(this.chronos.isActive(canvas));
    host.appendChild(bar.el);
    this.toolbars.set(canvas, bar);
  }
  /** Keep the overlay honest while nodes are being dragged. */
  patchFrame(canvas) {
    if (this.frameHooks.has(canvas)) return;
    this.frameHooks.add(canvas);
    const original = canvas.requestFrame.bind(canvas);
    canvas.requestFrame = () => {
      original();
      this.chrome.schedule(canvas);
      this.minimap.sync(canvas);
    };
  }
  /** Hooking iframes lets Tab create children while the caret is inside one. */
  hookFrames(canvas) {
    this.formats.hookCanvas(canvas);
    for (const node of canvas.nodes.values()) {
      node.nodeEl.querySelectorAll("iframe").forEach((frame) => {
        let doc = null;
        try {
          doc = frame.contentDocument;
        } catch {
          return;
        }
        if (!doc || this.hookedDocs.has(doc)) return;
        this.hookedDocs.add(doc);
        doc.addEventListener(
          "keydown",
          (evt) => {
            if (this.todo.onKeyDown(evt, doc)) return;
            if (evt.key !== "Tab" || evt.metaKey || evt.ctrlKey || evt.altKey) return;
            const owner = nodeById(canvas, node.id);
            if (!owner || !isMindmap(owner)) return;
            evt.preventDefault();
            evt.stopPropagation();
            owner.blur?.();
            this.mindmap.addChild(canvas, owner.id);
          },
          true
        );
      });
    }
  }
  onPointerMove(evt) {
    if (evt.buttons === 0) return;
    const canvas = activeCanvas(this.app);
    if (canvas) this.chrome.schedule(canvas);
  }
  syncSelectionChrome() {
    const canvas = activeCanvas(this.app);
    if (canvas) this.chrome.schedule(canvas);
  }
  // ----------------------------------------------------------------- tools
  onTool(canvas, tool) {
    this.setActive(canvas, tool);
    if (tool === "select") {
      this.setPlacing(null);
      this.connect.exit();
      return;
    }
    if (tool === "connect") {
      this.setPlacing(null);
      this.connect.enter(canvas);
      return;
    }
    this.connect.exit();
    if (tool === "todo") {
      this.setPlacing({ canvas, kind: "note", text: DEFAULTS.todo });
      return;
    }
    this.setPlacing({ canvas, kind: tool });
  }
  setPlacing(next) {
    if (this.placing) this.placing.canvas.wrapperEl.classList.remove("jce-placing");
    this.placing = next;
    if (next) next.canvas.wrapperEl.classList.add("jce-placing");
  }
  onPlaceClick(evt) {
    const placing = this.placing;
    if (!placing) return;
    if (evt.button !== 0) return;
    if (!placing.canvas.wrapperEl.contains(evt.target)) return;
    if (isInsideCanvasUi(evt.target)) return;
    evt.preventDefault();
    evt.stopPropagation();
    const at = placing.canvas.posFromEvt(evt);
    createObject(this.chrome, {
      canvas: placing.canvas,
      kind: placing.kind,
      at,
      text: placing.text,
      caretAtEnd: !!placing.text
    });
    this.setPlacing(null);
    this.setActive(placing.canvas, "select");
  }
  setActive(canvas, tool) {
    this.toolbars.get(canvas)?.setActive(tool);
  }
  // -------------------------------------------------------------- keyboard
  onKey(evt) {
    if (evt.defaultPrevented) return;
    if (evt.isComposing) return;
    const canvas = activeCanvas(this.app);
    if (!canvas) return;
    if (evt.key === "Escape") {
      if (this.search.isOpen(canvas)) {
        evt.preventDefault();
        evt.stopPropagation();
        this.search.close(canvas);
        return;
      }
      if (this.focus.isActive(canvas)) {
        evt.preventDefault();
        evt.stopPropagation();
        this.focus.exit(canvas);
        return;
      }
      if (this.chronos.isActive(canvas) && !isTyping(evt.target)) {
        evt.preventDefault();
        evt.stopPropagation();
        this.chronos.close(canvas);
        return;
      }
      this.setPlacing(null);
      this.connect.exit();
      this.formats.hide();
      this.setActive(canvas, "select");
      return;
    }
    if (evt.metaKey || evt.ctrlKey) {
      if (!evt.shiftKey && !evt.altKey) {
        const key = evt.key.toLowerCase();
        if (key === "f") {
          if (isTyping(evt.target)) return;
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation();
          this.search.open(canvas);
          return;
        }
        if (key === "g") {
          if (isTyping(evt.target)) return;
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation();
          this.groupSelection(canvas);
          this.setActive(canvas, "select");
        }
      }
      return;
    }
    if (evt.key === "Tab") {
      if (isTyping(evt.target)) return;
      const node = this.activeMindmapNode(canvas);
      if (!node) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.mindmap.addChild(canvas, node.id);
      return;
    }
    if (isTyping(evt.target)) return;
    if (evt.altKey || evt.shiftKey) return;
    const lower = evt.key.toLowerCase();
    if (lower === "f") {
      if (this.focus.isActive(canvas) || selectedNodes(canvas).length > 0) {
        evt.preventDefault();
        this.focus.toggle(canvas);
      }
      return;
    }
    const tool = TOOL_KEYS[lower];
    if (!tool) return;
    evt.preventDefault();
    this.onTool(canvas, tool);
    if (tool !== "select" && tool !== "connect") {
      this.setPlacing(null);
      const kind = tool === "todo" ? "note" : tool;
      createObject(this.chrome, {
        canvas,
        kind,
        at: viewportCenter(canvas, KIND_SIZE[kind]),
        text: tool === "todo" ? DEFAULTS.todo : void 0,
        caretAtEnd: tool === "todo"
      });
      this.setActive(canvas, "select");
    }
  }
  /**
   * The mindmap node Tab applies to. Dragging pre-selects a whole subtree, so
   * with several nodes selected we take the topmost one (the one that is not a
   * descendant of another selected node) — that is the node the user clicked.
   */
  activeMindmapNode(canvas) {
    const selected = selectedNodes(canvas).filter((n) => isMindmap(n));
    if (selected.length === 1) return selected[0];
    if (selected.length > 1) {
      const ids = new Set(selected.map((n) => n.id));
      const roots = selected.filter((n) => {
        const rootId = rootIdOf(n) ?? n.id;
        const tree = treeOf(canvas, rootId);
        for (const other of ids) {
          if (other === n.id) continue;
          if (descendantsOf(tree, other).includes(n.id)) return false;
        }
        return true;
      });
      if (roots.length === 1) return roots[0];
    }
    for (const node of canvas.nodes.values()) {
      if (isMindmap(node) && isEditing(node)) return node;
    }
    return void 0;
  }
  // --------------------------------------------------------------- actions
  setColor(canvas, nodeId, color) {
    const node = canvas.nodes.get(nodeId);
    if (!node) return;
    node.setColor?.(color);
    const next = { ...node.getData() };
    if (color) next.color = color;
    else delete next.color;
    node.setData(next);
    this.chrome.paintNode(node);
    this.chrome.invalidate(canvas);
    commit(canvas);
  }
  /** Note-card background lives in the .canvas file (`jceBg`), so it survives
   *  restarts and travels with the file. */
  setCardBg(canvas, nodeId, color) {
    const node = canvas.nodes.get(nodeId);
    if (!node || kindOf(node) !== "note") return;
    const next = { ...node.getData() };
    if (color) next[CARD_BG] = color;
    else delete next[CARD_BG];
    node.setData(next);
    this.chrome.paintNode(node);
    this.chrome.invalidate(canvas);
    commit(canvas);
  }
  /**
   * Removing a mindmap node removes its descendants too — leaving orphans
   * behind would silently break the hierarchy. PRD §10.1 marks the treatment
   * of descendants as undecided, so this is a documented proposal.
   */
  groupSelection(canvas, fallbackNode) {
    const sel = selectedNodes(canvas).filter(
      (n) => !n.nodeEl.classList.contains("jce-sec-hidden")
    );
    let targets;
    if (fallbackNode) {
      targets = sel.some((n) => n.id === fallbackNode.id) ? sel : [fallbackNode];
    } else {
      targets = sel;
    }
    if (!targets.length) {
      createObject(this.chrome, {
        canvas,
        kind: "section",
        at: viewportCenter(canvas, KIND_SIZE.section)
      });
      return;
    }
    const box = unionRect(targets.map(rectOf));
    if (!box) return;
    const padX = 32;
    const padTop = 44;
    const padBottom = 32;
    const group = canvas.createGroupNode({
      pos: { x: Math.round(box.x - padX), y: Math.round(box.y - padTop) },
      size: {
        width: Math.round(box.width + padX * 2),
        height: Math.round(box.height + padTop + padBottom)
      },
      label: DEFAULTS.section,
      focus: false,
      save: true
    });
    if (!group) return;
    tag(canvas, group, "section");
    commit(canvas);
    this.chrome.invalidate(canvas);
    canvas.selectOnly(group);
  }
  alignSelection(canvas, op) {
    if (applyAlignment(canvas, op)) {
      this.chrome.invalidate(canvas);
      this.minimap.sync(canvas);
    }
  }
  removeNode(canvas, nodeId) {
    const node = canvas.nodes.get(nodeId);
    if (!node) return;
    const ids = [nodeId];
    if (isMindmap(node)) {
      const rootId = rootIdOf(node) ?? node.id;
      ids.push(...descendantsOf(treeOf(canvas, rootId), nodeId));
    }
    deleteNodes(canvas, ids);
    this.chrome.invalidate(canvas);
  }
};
function canvasOf(leaf) {
  const view = leaf.view;
  return view.canvas ?? null;
}
function activeCanvas(app) {
  const view = app.workspace.getActiveViewOfType(import_obsidian10.FileView);
  if (!view || view.getViewType() !== "canvas") return null;
  return view.canvas ?? null;
}
function nodeById(canvas, id) {
  return canvas.nodes.get(id);
}
function isTyping(target) {
  if (document.activeElement instanceof HTMLIFrameElement) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "IFRAME") return true;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;
  const tag2 = target.tagName;
  if (tag2 === "INPUT" || tag2 === "TEXTAREA" || tag2 === "SELECT") return true;
  return !!target.closest(".cm-editor, .cm-content");
}
