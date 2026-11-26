/**
 * menus.ts — blank-area creation menu and object context menu (PRD §7).
 *
 * MENU-02 matters most: when a menu is open, clicking blank space must only
 * close the menu. We swallow that pointerdown in the capture phase before it
 * can reach the canvas drag/pan handler, and close the menu ourselves so the
 * behaviour does not depend on Obsidian's dismissal timing.
 */

import { FileView, Menu, type Plugin } from "obsidian";
import { CanvasLike, NodeLike, Point, isInsideCanvasUi, selectedNodes } from "./bridge";
import { ALIGN_OPS, AlignOp, MENU, TOOLS, menuLabel } from "./copy";
import {
  CARD_BG_PALETTE,
  Kind,
  cardBgOf,
  hasChildren,
  isCardFolded,
  isCollapsible,
  isFolded,
  isGroupNode,
  isMindmap,
  kindOf,
} from "./model";

type Handlers = {
  create: (canvas: CanvasLike, kind: Kind, at?: Point) => void;
  remove: (canvas: CanvasLike, nodeId: string) => void;
  setColor: (canvas: CanvasLike, nodeId: string, color: string) => void;
  setCardBg: (canvas: CanvasLike, nodeId: string, color: string) => void;
  rotate: (canvas: CanvasLike, nodeId: string) => void;
  setFolded: (canvas: CanvasLike, nodeId: string, folded: boolean) => void;
  focus: (canvas: CanvasLike, node: NodeLike) => void;
  unfocus: (canvas: CanvasLike) => void;
  isFocused: (canvas: CanvasLike) => boolean;
  groupSelection: (canvas: CanvasLike, fallbackNode?: NodeLike) => void;
  alignSelection: (canvas: CanvasLike, op: AlignOp) => void;
  toggleCardFold: (canvas: CanvasLike, nodeId: string) => void;
  setCardTime: (canvas: CanvasLike, node: NodeLike) => void;
  chronosFocusNode: (canvas: CanvasLike, node: NodeLike) => void;
  exportPng: (canvas: CanvasLike, targetNodes?: NodeLike[]) => void;
};

const PALETTE: { id: string; label: string; swatch: string }[] = [
  { id: "", label: "默认 / Default", swatch: "#d8d8d8" },
  { id: "1", label: "红 / Red", swatch: "#fb464c" },
  { id: "2", label: "橙 / Orange", swatch: "#e9973f" },
  { id: "3", label: "黄 / Yellow", swatch: "#e0de71" },
  { id: "4", label: "绿 / Green", swatch: "#44cf6e" },
  { id: "5", label: "青 / Cyan", swatch: "#53c9e1" },
  { id: "6", label: "紫 / Purple", swatch: "#a882ff" },
];

const CREATE_ORDER: Kind[] = ["note", "text", "mindmap", "section"];

export class ContextMenus {
  private open: Menu | null = null;
  private closedAt = 0;

  constructor(
    private plugin: Plugin,
    private handlers: Handlers
  ) {
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt: PointerEvent) => this.onPointerDown(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "contextmenu",
      (evt: MouseEvent) => this.onContextMenu(evt),
      true
    );
  }

  private get menuOpen(): boolean {
    return !!this.open;
  }

  private onPointerDown(evt: PointerEvent): void {
    const target = evt.target as Element | null;
    if (this.open) {
      // Clicking inside the menu is the menu's business.
      if (target?.closest?.(".menu")) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.hide();
      return;
    }
    if (Date.now() - this.closedAt < 150) {
      // Swallow the very next press after a dismissal (MENU-02).
      evt.preventDefault();
      evt.stopPropagation();
    }
  }

  private hide(): void {
    this.open?.hide();
    this.open = null;
    this.closedAt = Date.now();
  }

  private onContextMenu(evt: MouseEvent): void {
    const target = evt.target as Element | null;
    if (isInsideCanvasUi(target)) return;
    const wrapper = target?.closest?.(".canvas-wrapper");
    if (!(wrapper instanceof HTMLElement)) return;
    const canvas = canvasFromWrapper(this.plugin, wrapper);
    if (!canvas) return;

    evt.preventDefault();
    evt.stopPropagation();
    this.hide();

    const node = nodeFromWrapper(canvas, target);
    const menu = new Menu();
    if (node) this.buildObjectMenu(menu, canvas, node);
    else this.buildBlankMenu(menu, canvas, canvas.posFromEvt(evt));

    this.open = menu;
    menu.onHide(() => {
      if (this.open === menu) this.open = null;
      this.closedAt = Date.now();
    });
    menu.showAtMouseEvent(evt);
  }

  private buildBlankMenu(menu: Menu, canvas: CanvasLike, at: Point): void {
    for (const kind of CREATE_ORDER) {
      const meta = TOOLS[kind];
      menu.addItem((item) =>
        item
          .setTitle(menuLabel(meta))
          .setIcon(ICON_FOR[kind])
          .onClick(() => this.handlers.create(canvas, kind, at))
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(menuLabel(MENU.exportCanvas))
        .setIcon("download")
        .onClick(() => this.handlers.exportPng(canvas))
    );
  }

  private buildObjectMenu(menu: Menu, canvas: CanvasLike, node: NodeLike): void {
    menu.addItem((item) => {
      item.setTitle(menuLabel(MENU.color)).setIcon("palette");
      // `setSubmenu` is real but undocumented (absent from the public typings),
      // so fall back to flat items where it is unavailable.
      const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
      const target: Menu = sub ?? menu;
      for (const color of PALETTE) {
        target.addItem((row) =>
          row
            .setTitle(color.label)
            .setChecked((node.color ?? "") === color.id)
            .onClick(() => this.handlers.setColor(canvas, node.id, color.id))
        );
      }
    });

    // Card background is a note-card-only property (PRD NOTE-01, extended by
    // JOY 2026-11-19). Native cards keep Obsidian's own colour logic.
    if (kindOf(node) === "note") {
      menu.addItem((item) => {
        item.setTitle(menuLabel(MENU.cardBg)).setIcon("paint-bucket");
        const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
        const target: Menu = sub ?? menu;
        const current = cardBgOf(node);
        for (const bg of CARD_BG_PALETTE) {
          target.addItem((row) =>
            row
              .setTitle(menuLabel(bg))
              .setChecked(current === bg.value)
              .onClick(() => this.handlers.setCardBg(canvas, node.id, bg.value))
          );
        }
      });
    }

    if (isCollapsible(node)) {
      const folded = isCardFolded(node);
      const item = folded ? MENU.expandCard : MENU.collapseCard;
      menu.addItem((row) =>
        row
          .setTitle(menuLabel(item))
          .setIcon(folded ? "chevrons-down-up" : "chevrons-up-down")
          .onClick(() => this.handlers.toggleCardFold(canvas, node.id))
      );
    }

    const focused = this.handlers.isFocused(canvas);
    menu.addItem((row) =>
      row
        .setTitle(menuLabel(focused ? MENU.unfocus : MENU.focus))
        .setIcon("eye")
        .onClick(() => {
          if (focused) this.handlers.unfocus(canvas);
          else this.handlers.focus(canvas, node);
        })
    );

    const sel = selectedNodes(canvas);
    if (sel.length >= 2) {
      menu.addItem((item) => {
        item.setTitle(menuLabel(MENU.align)).setIcon("align-start-vertical");
        const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
        const target: Menu = sub ?? menu;
        const ops: AlignOp[] =
          sel.length >= 3
            ? ["left", "centerX", "right", "top", "centerY", "bottom", "distX", "distY"]
            : ["left", "centerX", "right", "top", "centerY", "bottom"];
        for (const op of ops) {
          target.addItem((row) =>
            row
              .setTitle(menuLabel(ALIGN_OPS[op]))
              .onClick(() => this.handlers.alignSelection(canvas, op))
          );
        }
      });
    }

    if (sel.length > 1 || !isGroupNode(node)) {
      menu.addItem((row) =>
        row
          .setTitle(menuLabel(MENU.groupSection))
          .setIcon("frame")
          .onClick(() => this.handlers.groupSelection(canvas, node))
      );
    }

    if (!isGroupNode(node)) {
      menu.addItem((row) =>
        row
          .setTitle(menuLabel(MENU.chronosFocus))
          .setIcon("hourglass")
          .onClick(() => this.handlers.chronosFocusNode(canvas, node))
      );
      menu.addItem((row) =>
        row
          .setTitle(menuLabel(MENU.setTime))
          .setIcon("calendar")
          .onClick(() => this.handlers.setCardTime(canvas, node))
      );
    }

    const isMultiSelection = sel.length >= 2 && sel.some((n) => n.id === node.id);
    const exportTargets = isMultiSelection ? sel : [node];
    const exportLabel = isMultiSelection
      ? MENU.exportSelection
      : isGroupNode(node)
        ? MENU.exportSection
        : MENU.exportCard;

    menu.addItem((item) =>
      item
        .setTitle(menuLabel(exportLabel))
        .setIcon("download")
        .onClick(() => this.handlers.exportPng(canvas, exportTargets))
    );

    menu.addItem((item) =>
      item
        .setTitle(menuLabel(MENU.remove))
        .setIcon("trash")
        .onClick(() => this.handlers.remove(canvas, node.id))
    );

    if (isMindmap(node)) {
      if (hasChildren(canvas, node.id)) {
        const folded = isFolded(canvas, node.id);
        const item = folded ? MENU.unfold : MENU.fold;
        menu.addItem((row) =>
          row
            .setTitle(menuLabel(item))
            .setIcon(folded ? "chevrons-down-up" : "chevrons-up-down")
            .onClick(() => this.handlers.setFolded(canvas, node.id, !folded))
        );
      }
      menu.addItem((row) =>
        row
          .setTitle(menuLabel(MENU.rotate))
          .setIcon("rotate-cw")
          .onClick(() => this.handlers.rotate(canvas, node.id))
      );
    }
  }
}

const ICON_FOR: Record<Kind, string> = {
  note: "sticky-note",
  text: "type",
  mindmap: "network",
  section: "frame",
};

function canvasFromWrapper(plugin: Plugin, wrapper: HTMLElement): CanvasLike | null {
  for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
    const view = leaf.view as { canvas?: CanvasLike };
    if (view.canvas?.wrapperEl === wrapper) return view.canvas;
  }
  const active = plugin.app.workspace.getActiveViewOfType(FileView);
  if (active && active.getViewType() === "canvas") {
    return (active as unknown as { canvas?: CanvasLike }).canvas ?? null;
  }
  return null;
}

function nodeFromWrapper(canvas: CanvasLike, target: Element | null): NodeLike | null {
  const el = target?.closest?.(".canvas-node");
  if (!(el instanceof HTMLElement)) return null;
  for (const node of canvas.nodes.values()) {
    if (node.nodeEl === el || node.nodeEl.contains(el) || el.contains(node.nodeEl)) return node;
  }
  return null;
}
