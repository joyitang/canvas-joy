/**
 * Locked UI copy — PRD §8.1 ("已校对锁定").
 * Do not change these strings without a new user-confirmed proofreading pass.
 */

export const TOOLS = {
  select: { id: "select", zh: "选择", en: "Select", key: "V" },
  connect: { id: "connect", zh: "连线", en: "Connect", key: "C" },
  note: { id: "note", zh: "笔记卡", en: "Note card", key: "N" },
  text: { id: "text", zh: "文字", en: "Text", key: "T" },
  todo: { id: "todo", zh: "待办", en: "To-do", key: "D" },
  mindmap: { id: "mindmap", zh: "思维导图", en: "Mindmap", key: "M" },
  section: { id: "section", zh: "分区", en: "Section", key: "G" },
} as const;

export type ToolId = keyof typeof TOOLS;

export const SEARCH_TOOL = { id: "search", zh: "搜索", en: "Search", key: "⌘F" } as const;
export const MINIMAP_TOOL = { id: "minimap", zh: "小地图", en: "Minimap" } as const;
export const CHRONOS_TOOL = { id: "chronos", zh: "时间轴", en: "Chronos" } as const;

export const ALIGN_OPS = {
  left: { zh: "左对齐", en: "Align left" },
  centerX: { zh: "水平居中", en: "Align horizontal centers" },
  right: { zh: "右对齐", en: "Align right" },
  top: { zh: "顶对齐", en: "Align top" },
  centerY: { zh: "垂直居中", en: "Align vertical centers" },
  bottom: { zh: "底对齐", en: "Align bottom" },
  distX: { zh: "水平等距分布", en: "Distribute horizontally" },
  distY: { zh: "垂直等距分布", en: "Distribute vertically" },
} as const;

export type AlignOp = keyof typeof ALIGN_OPS;

export const MENU = {
  color: { zh: "颜色", en: "Color" },
  cardBg: { zh: "卡片底色", en: "Card background" },
  remove: { zh: "移除", en: "Remove" },
  fold: { zh: "折叠", en: "Fold" },
  unfold: { zh: "展开", en: "Unfold" },
  rotate: { zh: "旋转", en: "Rotate" },
  focus: { zh: "聚焦", en: "Focus" },
  unfocus: { zh: "退出聚焦", en: "Exit focus" },
  groupSection: { zh: "打包进分区", en: "Group into section" },
  align: { zh: "对齐与分布", en: "Align & distribute" },
  collapseCard: { zh: "折叠", en: "Collapse" },
  expandCard: { zh: "展开", en: "Expand" },
  setTime: { zh: "指定年份", en: "Set time" },
  chronosFocus: { zh: "时间轴查看", en: "View in Chronos" },
} as const;

export const DEFAULTS = {
  noteCard: "Note Card",
  todo: "- [ ] ",
  section: "Section",
  mindmapRoot: "Mindmap",
  text: "",
} as const;

export function tooltip(tool: { zh: string; en: string; key?: string }): string {
  return tool.key ? `${tool.zh} / ${tool.en}  ${tool.key}` : `${tool.zh} / ${tool.en}`;
}

export function menuLabel(item: { zh: string; en: string }): string {
  return `${item.zh} / ${item.en}`;
}
