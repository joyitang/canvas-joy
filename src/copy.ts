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
  collapseCard: { zh: "折叠", en: "Collapse" },
  expandCard: { zh: "展开", en: "Expand" },
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
