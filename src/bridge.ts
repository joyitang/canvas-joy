/**
 * bridge.ts — the only module that touches Obsidian's private Canvas internals.
 *
 * Everything here was verified against Obsidian 1.15.0 at runtime (not guessed):
 *  - `canvas.canvasEl` is the world-space layer carrying
 *    `transform: translate(x,y) scale(z)`; children are the two edge <svg>
 *    layers followed by the `.canvas-node` elements.
 *  - `canvas.nodes` / `canvas.edges` are Maps of the live model objects.
 *  - A node's `getData()` re-emits unrecognised properties via `unknownData`,
 *    so custom tags round-trip into the `.canvas` file itself.
 *  - Edges are `new Edge(canvas, id, {node, side, end}, {node, side, end})`.
 *
 * If a future Obsidian release changes any of this, failure is contained here.
 */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;
export type BBox = { minX: number; minY: number; maxX: number; maxY: number };
export type Side = "top" | "right" | "bottom" | "left";
export type EdgeEnd = "none" | "arrow";

export type RawNode = Record<string, unknown> & {
  id: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: string;
  color?: string;
};

export type RawEdge = Record<string, unknown> & {
  id: string;
  fromNode: string;
  toNode: string;
};

export type CanvasData = { nodes: RawNode[]; edges: RawEdge[] };

export interface NodeLike {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  label?: string;
  file?: { path?: string; basename?: string; name?: string } | null;
  filePath?: string;
  isEditing?: boolean;
  unknownData?: Record<string, unknown>;
  nodeEl: HTMLElement;
  containerEl?: HTMLElement;
  contentEl?: HTMLElement;
  placeholderEl?: HTMLElement;
  getData(): RawNode;
  setData(data: RawNode): void;
  setText?(text: string): void;
  startEditing?(): void;
  blur?(): void;
  setColor?(color: string): void;
  getBBox?(): BBox;
  resize?(size: Size): void;
  moveAndResize?(rect: Rect): void;
  render?(): void;
}

export interface EdgeLike {
  id: string;
  from: { node: NodeLike; side: Side; end: EdgeEnd };
  to: { node: NodeLike; side: Side; end: EdgeEnd };
  lineGroupEl?: Element;
  lineEndGroupEl?: Element;
  getData(): RawEdge;
  render?(): void;
  destroy?(): void;
  update?(from: EdgeLike["from"], to: EdgeLike["to"]): void;
}

export type EdgeCtor = new (
  canvas: CanvasLike,
  id: string,
  from: EdgeLike["from"],
  to: EdgeLike["to"]
) => EdgeLike;

export interface CanvasLike {
  wrapperEl: HTMLElement;
  canvasEl: HTMLElement;
  edgeContainerEl?: Element;
  nodes: Map<string, NodeLike>;
  edges: Map<string, EdgeLike>;
  selection: Set<NodeLike>;
  x?: number;
  y?: number;
  zoom?: number;
  scale?: number;
  zoomBreakpoint?: number;
  tZoom?: number;
  tx?: number;
  ty?: number;
  requestSave(): void;
  requestFrame(): void;
  getData(): CanvasData;
  setData(data: CanvasData): void;
  importData(data: CanvasData, removeStale?: boolean): void;
  pushHistory?(data: CanvasData): void;
  zoomToBbox?(bbox: BBox): void;
  panIntoView?(bbox: BBox, margin?: number): void;
  setViewport?(x: number, y: number, zoom: number): void;
  markViewportChanged?(): void;
  getContainingNodes?(bbox: BBox): NodeLike[];
  createTextNode(opts: {
    pos: Point;
    size?: Size;
    position?: string;
    text?: string;
    save?: boolean;
    focus?: boolean;
  }): NodeLike;
  createGroupNode(opts: {
    pos: Point;
    size?: Size;
    label?: string;
    save?: boolean;
    focus?: boolean;
  }): NodeLike;
  addEdge(edge: EdgeLike): void;
  removeEdge(edge: EdgeLike): void;
  removeNode(node: NodeLike): void;
  selectOnly(node: NodeLike): void;
  select(node: NodeLike): void;
  deselect(node: NodeLike): void;
  deselectAll(): void;
  posFromEvt(evt: MouseEvent): Point;
  getViewportBBox(): BBox;
}

const edgeCtors = new WeakMap<object, EdgeCtor>();

export function uid(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function wrapper(canvas: CanvasLike): HTMLElement {
  return canvas.wrapperEl;
}

export function worldLayer(canvas: CanvasLike): HTMLElement {
  return canvas.canvasEl;
}

export function allNodes(canvas: CanvasLike): NodeLike[] {
  return Array.from(canvas.nodes.values());
}

export function getNode(canvas: CanvasLike, id: string): NodeLike | undefined {
  return canvas.nodes.get(id);
}

export function allEdges(canvas: CanvasLike): EdgeLike[] {
  return Array.from(canvas.edges.values());
}

export function zoomOf(canvas: CanvasLike): number {
  const z = canvas.tZoom;
  return typeof z === "number" && z > 0 ? z : 1;
}

export function scaleOf(canvas: CanvasLike): number {
  if (typeof canvas.scale === "number" && Number.isFinite(canvas.scale) && canvas.scale > 0) {
    return canvas.scale;
  }
  const z = canvas.zoom ?? canvas.tZoom;
  if (typeof z === "number" && Number.isFinite(z)) {
    return Math.pow(2, z);
  }
  return 1;
}

export function focusNodeInViewport(canvas: CanvasLike, node: NodeLike): void {
  const pad = Math.max(120, Math.min(node.width, node.height) * 0.6);
  const bbox: BBox = {
    minX: node.x - pad,
    minY: node.y - pad,
    maxX: node.x + node.width + pad,
    maxY: node.y + node.height + pad,
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

export function isEditing(node: NodeLike): boolean {
  if (node.isEditing) return true;
  return !!node.nodeEl?.classList.contains("is-editing");
}

/** Viewport centre in world coordinates. */
export function viewportCenter(canvas: CanvasLike, size: Size): Point {
  const box = canvas.getViewportBBox();
  return {
    x: Math.round((box.minX + box.maxX) / 2 - size.width / 2),
    y: Math.round((box.minY + box.maxY) / 2 - size.height / 2),
  };
}

/** Node under a DOM event, by element identity (1.15 keeps no id attribute). */
export function nodeFromEvent(canvas: CanvasLike, evt: Event | Element): NodeLike | null {
  const target = evt instanceof Element ? evt : (evt.target as Element | null);
  if (!target) return null;
  const el = target.closest?.(".canvas-node") as HTMLElement | null;
  const scopeEl = el instanceof HTMLElement ? el : target instanceof HTMLElement ? target : null;
  if (!scopeEl) return null;
  for (const node of canvas.nodes.values()) {
    const nel = node.nodeEl;
    if (!nel) continue;
    if (nel === scopeEl || nel.contains(scopeEl) || scopeEl.contains(nel)) return node;
  }
  return null;
}

export function isInsideCanvasUi(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest(
    ".jce-toolbar, .jce-format-bar, .jce-menu, .jce-search-bar, .jce-focus-pill, .jce-fold-btn, .jce-collapsed-bar, .jce-align-bar, .jce-minimap, .menu, .modal-container, .canvas-controls, .canvas-card-menu, .canvas-menu"
  );
}

/** Persist a change through the canvas so it lands in the `.canvas` file. */
export function commit(canvas: CanvasLike): void {
  canvas.requestSave();
  canvas.requestFrame();
}

export function setNodeData(canvas: CanvasLike, node: NodeLike, patch: Record<string, unknown>): void {
  const next = { ...node.getData(), ...patch } as RawNode;
  node.setData(next);
  canvas.requestSave();
}

export function setNodeText(canvas: CanvasLike, node: NodeLike, text: string): void {
  if (typeof node.setText === "function") node.setText(text);
  else setNodeData(canvas, node, { text });
  canvas.requestSave();
  canvas.requestFrame();
}

export function edgeCtor(canvas: CanvasLike): EdgeCtor | undefined {
  const cached = edgeCtors.get(canvas);
  if (cached) return cached;
  const first = canvas.edges.values().next();
  if (first.done) return undefined;
  const ctor = (first.value as unknown as { constructor: EdgeCtor }).constructor;
  edgeCtors.set(canvas, ctor);
  return ctor;
}

export function findEdge(
  canvas: CanvasLike,
  fromId: string,
  toId: string
): EdgeLike | undefined {
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id === fromId && edge.to.node.id === toId) return edge;
  }
  return undefined;
}

/**
 * Create a real canvas edge. Arrow semantics follow native Canvas: the arrow
 * head points at the target object (PRD CON-02).
 *
 * The first edge in a canvas has no live instance to borrow a constructor
 * from, so that single case goes through `setData`, which also gives us an
 * undo entry.
 */
export function createEdge(
  canvas: CanvasLike,
  from: NodeLike,
  to: NodeLike,
  sides: { from: Side; to: Side }
): EdgeLike | undefined {
  const existing = findEdge(canvas, from.id, to.id);
  if (existing) return existing;

  const ctor = edgeCtor(canvas);
  if (ctor) {
    const edge = new ctor(
      canvas,
      uid(),
      { node: from, side: sides.from, end: "none" },
      { node: to, side: sides.to, end: "arrow" }
    );
    canvas.addEdge(edge);
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
  } as RawEdge);
  canvas.setData(data);
  const made = canvas.edges.get(id);
  if (made) edgeCtors.set(canvas, (made as unknown as { constructor: EdgeCtor }).constructor);
  canvas.requestFrame();
  return made;
}

export function removeEdge(canvas: CanvasLike, edge: EdgeLike): void {
  canvas.removeEdge(edge);
  commit(canvas);
}

export function deleteNodes(canvas: CanvasLike, ids: Iterable<string>): void {
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

export function selectedNodes(canvas: CanvasLike): NodeLike[] {
  return Array.from(canvas.selection ?? []);
}

export function findEditingNode(canvas: CanvasLike): NodeLike | undefined {
  for (const node of canvas.nodes.values()) {
    if (isEditing(node)) return node;
  }
  return undefined;
}

/** Sides to use for a plain connection, based on relative placement. */
export function autoSides(a: Rect, b: Rect): { from: Side; to: Side } {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  }
  return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}

export const sideOpposite: Record<Side, Side> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};
