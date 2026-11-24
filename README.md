# Canvas Joy

Bring **Heptabase-style visual thinking** directly to native Obsidian Canvas — tinted note cards, collapsible cards and sections, focus mode, in-canvas search, minimap, multi-select alignment, mindmaps, in-card to-dos, and a floating text format bar, all stored cleanly in standard `.canvas` files.

## Features

- **Heptabase-style Left Toolbar**: Quick creation and switching for Select (`V`), Connect (`C`), Note card (`N`), Text (`T`), To-do (`D`), Mindmap (`M`), Section (`G`), In-canvas Search (`⌘F`), and Minimap toggle.
- **Tinted Note Cards & Clean Text**: 9 soft card backgrounds (persisted in `.canvas`), frameless-feel text blocks, and translucent sections aligned with native Canvas groups.
- **In-Card To-dos**: Click checkboxes directly in preview mode without entering edit mode; type `[]` + space at line start to auto-convert into `- [ ] `; completed items strike through and dim automatically.
- **Floating Text Format Bar**: Select text inside any card to format Bold, Italic, Underline, Inline code, Highlight, Strikethrough, Link, Math, Text color, and Text background color.
- **Collapsible Cards & Sections**: Collapse any card (including cards inside sections) into a compact title bar with preserved color and to-do progress, or collapse an entire section to hide its children (dragging a collapsed section moves its hidden children together).
- **Focus Mode (`F`)**: Highlight only the selected card (or a selected section and its inner cards) while dimming everything else to 15%. Press `F`, `Esc`, or click blank space to exit.
- **In-Canvas Search (`⌘F`)**: Real-time filter across cards and sections with match count, dropdown preview list, `Enter` / arrow cycling, and smooth pan-to-center.
- **Multi-Select Alignment & Distribution**: Selecting 2+ cards automatically reveals a floating alignment bar (6-way align + horizontal/vertical even distribution for 3+ cards), with full `⌘Z` undo support.
- **Whiteboard Minimap**: Hidden by default (Heptabase style); toggle from the bottom of the toolbar to view an overview in the bottom-right corner and click or drag to navigate large canvases.
- **Zoom-Out Readability**: Below Obsidian's native zoom-out breakpoint (`≤ 32%`), replaces blank card icons with readable counter-scaled titles, to-do badges, and enlarged section headers.
- **Mindmaps**: Vertical or horizontal hierarchy lines drawn cleanly on a world-space SVG overlay, `Tab` to add child nodes, subtree dragging, and branch folding.

## Shortcuts & Actions

| Action | How |
|---|---|
| Select / Connect / Note / Text / To-do / Mindmap / Section | Left toolbar, or `V` `C` `N` `T` `D` `M` `G` |
| Group selection into section / New section | Select 1+ cards and press `⌘G` (or right-click → **Group into section**); with nothing selected, `⌘G` creates a centered section |
| In-canvas search | Toolbar magnifying glass or `⌘F`; `Enter` / `↑` `↓` to step, `Esc` to close |
| Focus mode | Select card(s) or section and press `F` (or right-click → **Focus**); `F` / `Esc` / click blank space to exit |
| Collapse / Expand card or section | Hover top-right collapse button, double-click collapsed bar, or right-click → **Collapse / Expand** |
| Align & distribute | Select 2+ cards for the top floating align bar, or right-click → **Align & distribute** |
| Toggle minimap | Bottom map icon on toolbar, or command palette **Toggle minimap** |
| Mindmap child | Select mindmap node and press `Tab` |
| Card background | Right-click a note card → **Card background** |
| Text format bar | Highlight text inside any card |

## Installation

### From Community Plugins (once listed)
1. Open **Settings → Community plugins → Browse**.
2. Search for **Canvas Joy**, install, and enable.

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub Release.
2. Place them in `<your-vault>/.obsidian/plugins/canvas-joy/`.
3. Reload Obsidian and enable **Canvas Joy** in **Settings → Community plugins**.

## Development

```bash
npm install
npm run check   # TypeScript type-check
npm run build   # Production bundle (main.js)
```

---

## 中文说明

**Canvas Joy** 在 Obsidian **原生 Canvas** 上补齐 **Heptabase 风格** 的视觉思考与整理体验，所有数据仍保存在标准 `.canvas` 文件中：

- **左侧工具栏与快捷键**：选择（`V`）、连线（`C`）、笔记卡（`N`）、文字（`T`）、待办（`D`）、思维导图（`M`）、分区（`G`）、画布内搜索（`⌘F`）、小地图开关。
- **笔记卡底色与划词格式条**：9 种柔和卡片底色（持久化写入 `.canvas`）；选中文字自动浮出格式条（粗体/斜体/下划线/代码/高亮/删除线/链接/公式/文字色/文字底色）。
- **卡片内待办**：预览态直接点复选框勾选，行首 `[]` + 空格自动转待办项，完成态自动灰化划线。
- **卡片与分区折叠**：顶层卡、分区内子卡及分区本身均可一键折叠为紧凑标题条并持久化；拖动折叠分区时内部子卡自动跟随。
- **聚焦模式（`F`）**：仅高亮选中卡片（或分区及其内部子卡），其余元素淡化至 15%，点空白处或按 `Esc` 退出。
- **画布内搜索（`⌘F`）**：实时筛选当前画布内容、显示计数与下拉列表、回车平滑居中高亮。
- **框选打包进分区（`⌘G`）**：选中卡片按 `⌘G` 自动包裹为原生透明风格分区；无选中时居中新建空分区。
- **多选对齐与等距分布**：框选 ≥2 张卡自动浮出顶部对齐条（6 向对齐 + ≥3 张水平/垂直等距），支持 `⌘Z` 撤销。
- **白板小地图**：默认隐藏（与 Heptabase 一致），点工具栏最底部图标展开，支持点击跳转与拖动视口平移。
- **远景缩放可读性**：画布缩到原生失效线（≤32%）时自动显示大字标题、待办进度与放大分区名，正常缩放区间完整保留原生正文与图片。

## License

[MIT](LICENSE)
