/**
 * model.ts — object kinds and mindmap structure.
 *
 * Types are stored in the canvas file itself, on each node, as an extra
 * property (`getData()` re-emits unknown properties). Parent/child relations
 * are stored as real canvas edges, so the structure survives restarts, file
 * copies and other devices without any sidecar database.
 */

import { CanvasLike, EdgeLike, NodeLike, RawNode } from "./bridge";

export type Kind = "note" | "text" | "mindmap" | "section";

export const TAG = "jce";
export const ROOT = "jceRoot";
export const LAYOUT = "jceLayout";
export const FOLD = "jceFold";
export const CARD_FOLD = "jceCardFold";
export const FOLD_HEIGHT = "jceFoldH";
export const FOLD_KIDS = "jceFoldKids";
/** Card background chosen from the object menu (note cards only). */
export const CARD_BG = "jceBg";

/** Soft palette in the spirit of Heptabase's card colours. */
export const CARD_BG_PALETTE: { value: string; zh: string; en: string }[] = [
  { value: "", zh: "默认", en: "Default" },
  { value: "#ffffff", zh: "白", en: "White" },
  { value: "#fbf7ee", zh: "奶油", en: "Cream" },
  { value: "#fbf1c4", zh: "黄", en: "Yellow" },
  { value: "#e3f1d9", zh: "绿", en: "Green" },
  { value: "#dfeaf7", zh: "蓝", en: "Blue" },
  { value: "#f8e1e4", zh: "粉", en: "Pink" },
  { value: "#ece5f7", zh: "紫", en: "Purple" },
  { value: "#eeeeee", zh: "灰", en: "Grey" },
];

export function cardBgOf(node: NodeLike): string {
  const value = dataOf(node)[CARD_BG];
  return typeof value === "string" ? value : "";
}

export type Layout = "TB" | "LR" | "BT" | "RL";

export const LAYOUT_ORDER: Layout[] = ["TB", "LR", "BT", "RL"];

export function dataOf(node: NodeLike): RawNode {
  return node.getData();
}

export function kindOf(node: NodeLike): Kind | undefined {
  const kind = dataOf(node)[TAG];
  return kind === "note" || kind === "text" || kind === "mindmap" || kind === "section"
    ? kind
    : undefined;
}

export function isMindmap(node: NodeLike): boolean {
  return kindOf(node) === "mindmap";
}

export function rootIdOf(node: NodeLike): string | undefined {
  const id = dataOf(node)[ROOT];
  return typeof id === "string" ? id : undefined;
}

export function layoutOf(canvas: CanvasLike, rootId: string): Layout {
  const root = canvas.nodes.get(rootId);
  const raw = root ? dataOf(root)[LAYOUT] : undefined;
  return raw === "TB" || raw === "LR" || raw === "BT" || raw === "RL" ? raw : "TB";
}

export function nextLayout(layout: Layout): Layout {
  const i = LAYOUT_ORDER.indexOf(layout);
  return LAYOUT_ORDER[(i + 1) % LAYOUT_ORDER.length];
}

export type Tree = {
  rootId: string;
  layout: Layout;
  children: Map<string, string[]>;
  parent: Map<string, string>;
};

/** All mindmap nodes belonging to one root, plus their edge-derived structure. */
export function treeOf(canvas: CanvasLike, rootId: string): Tree {
  const members = new Set<string>();
  for (const node of canvas.nodes.values()) {
    if (isMindmap(node) && rootIdOf(node) === rootId) members.add(node.id);
  }
  members.add(rootId);

  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  for (const id of members) children.set(id, []);

  for (const edge of canvas.edges.values()) {
    const from = edge.from.node.id;
    const to = edge.to.node.id;
    if (!members.has(from) || !members.has(to)) continue;
    if (parent.has(to)) continue;
    parent.set(to, from);
    children.get(from)!.push(to);
  }

  // A cycle-free tree is assumed; guard against orphaned entries anyway.
  for (const [child, par] of parent) {
    if (!members.has(par)) parent.delete(child);
  }

  return { rootId, layout: layoutOf(canvas, rootId), children, parent };
}

/** Every mindmap root currently present in the canvas. */
export function rootIds(canvas: CanvasLike): string[] {
  const out: string[] = [];
  for (const node of canvas.nodes.values()) {
    if (!isMindmap(node)) continue;
    const root = rootIdOf(node);
    if (root === node.id) out.push(node.id);
  }
  return out;
}

export function descendantsOf(tree: Tree, id: string): string[] {
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

/** ids hidden because an ancestor is folded */
export function hiddenByFold(canvas: CanvasLike): Set<string> {
  const hidden = new Set<string>();
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

export function isFolded(canvas: CanvasLike, id: string): boolean {
  const node = canvas.nodes.get(id);
  return !!node && dataOf(node)[FOLD] === true;
}

export function hasChildren(canvas: CanvasLike, id: string): boolean {
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id === id && isMindmap(edge.to.node)) return true;
  }
  return false;
}

export function childrenOf(canvas: CanvasLike, id: string): NodeLike[] {
  const out: NodeLike[] = [];
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id !== id) continue;
    const child = canvas.nodes.get(edge.to.node.id);
    if (child && isMindmap(child)) out.push(child);
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y);
  return out;
}

/** Edges that belong to a mindmap (both endpoints are tagged mindmap). */
export function mindmapEdges(canvas: CanvasLike): EdgeLike[] {
  const out: EdgeLike[] = [];
  for (const edge of canvas.edges.values()) {
    if (isMindmap(edge.from.node) && isMindmap(edge.to.node)) out.push(edge);
  }
  return out;
}

export function mindmapNodeIds(canvas: CanvasLike): Set<string> {
  const ids = new Set<string>();
  for (const node of canvas.nodes.values()) {
    if (isMindmap(node)) ids.add(node.id);
  }
  return ids;
}

export function isGroupNode(node: NodeLike): boolean {
  return dataOf(node).type === "group" || kindOf(node) === "section";
}

export function isCollapsible(node: NodeLike): boolean {
  return !isMindmap(node);
}

export function isCardFolded(node: NodeLike): boolean {
  return dataOf(node)[CARD_FOLD] === true;
}

export function foldHeightOf(node: NodeLike): number | undefined {
  const h = dataOf(node)[FOLD_HEIGHT];
  return typeof h === "number" && Number.isFinite(h) && h > 0 ? h : undefined;
}

export function foldKidsOf(node: NodeLike): string[] {
  const kids = dataOf(node)[FOLD_KIDS];
  if (!Array.isArray(kids)) return [];
  return kids.filter((id): id is string => typeof id === "string");
}

/** Nodes contained inside a section/group (or stored in jceFoldKids when folded). */
export function nodesInsideGroup(canvas: CanvasLike, group: NodeLike): NodeLike[] {
  if (isCardFolded(group)) {
    const out: NodeLike[] = [];
    for (const id of foldKidsOf(group)) {
      const n = canvas.nodes.get(id);
      if (n && n.id !== group.id) out.push(n);
    }
    return out;
  }
  const gx1 = group.x;
  const gy1 = group.y;
  const gx2 = group.x + group.width;
  const gy2 = group.y + group.height;
  const out: NodeLike[] = [];
  for (const node of canvas.nodes.values()) {
    if (node.id === group.id) continue;
    if (isGroupNode(node)) {
      // Only include nested groups strictly smaller than this group
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

export function stripMarkdownLine(line: string): string {
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

export function nodeTextContent(node: NodeLike): string {
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

export function nodeTitleOf(node: NodeLike): string {
  const data = dataOf(node);
  if (isGroupNode(node)) {
    const lbl = (typeof node.label === "string" ? node.label : undefined) ??
      (typeof data.label === "string" ? data.label : "");
    return lbl.trim() || "Section";
  }
  if (data.type === "file") {
    const name = node.file?.basename ??
      (typeof data.file === "string" ? (data.file.split("/").pop() ?? data.file).replace(/\.md$/i, "") : "");
    return name.trim() || "未命名文件";
  }
  const raw = nodeTextContent(node);
  for (const line of raw.split(/\r?\n/)) {
    const clean = stripMarkdownLine(line);
    if (clean) return clean;
  }
  return kindOf(node) === "text" ? "Text" : "未命名卡片";
}

export function nodeSummaryOf(node: NodeLike): string {
  const data = dataOf(node);
  if (isGroupNode(node)) return "";
  if (data.type === "file") {
    return typeof data.file === "string" ? data.file : "";
  }
  const raw = nodeTextContent(node);
  const lines: string[] = [];
  let skippedTitle = false;
  for (const line of raw.split(/\r?\n/)) {
    const clean = stripMarkdownLine(line);
    if (!clean) continue;
    if (!skippedTitle) {
      skippedTitle = true;
      continue;
    }
    lines.push(clean);
    if (lines.join(" ").length >= 120 || lines.length >= 3) break;
  }
  const joined = lines.join(" · ");
  return joined.length > 120 ? joined.slice(0, 119) + "…" : joined;
}

export function todoProgressOf(text: string): { done: number; total: number } | null {
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
