/**
 * toolbar.ts — the Heptabase-style tool bar.
 *
 * Order follows the confirmed wording in PRD §4.2: Section is the entry
 * directly below Mindmap ("第一排、思维导图下面"). The exact pixel layout still
 * needs the original confirmation image, so this keeps the old vertical
 * arrangement rather than inventing a grid.
 */

import { setIcon } from "obsidian";
import {
  CHRONOS_TOOL,
  MINIMAP_TOOL,
  OUTLINE_TOOL,
  SEARCH_TOOL,
  TOOLS,
  ToolId,
  tooltip,
} from "./copy";
import { renderToolIcon } from "./icons";

export class CanvasToolbar {
  el: HTMLElement;
  private current: ToolId | null = "select";
  private searchBtn: HTMLButtonElement;
  private minimapBtn: HTMLButtonElement;
  private chronosBtn: HTMLButtonElement;
  private outlineBtn: HTMLButtonElement;

  constructor(
    private onPick: (id: ToolId) => void,
    private onSearch: () => void,
    private onMinimap: () => void,
    private onChronos: () => void,
    private onOutline: () => void
  ) {
    this.el = document.createElement("div");
    this.el.className = "jce-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Canvas Joy");

    const order: ToolId[] = ["select", "note", "text", "todo", "mindmap", "section"];
    order.forEach((id) => {
      if (id === "note") {
        this.el.createDiv({ cls: "jce-tool-sep" });
      }
      const meta = TOOLS[id];
      const btn = this.el.createEl("button", {
        type: "button",
        cls: "jce-tool",
        attr: {
          "data-tool": id,
          title: tooltip(meta),
          "aria-label": tooltip(meta),
        },
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
        "aria-label": tooltip(SEARCH_TOOL),
      },
    });
    setIcon(searchBtn, "search");
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
        "aria-label": tooltip(MINIMAP_TOOL),
      },
    });
    setIcon(minimapBtn, "map");
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
        "aria-label": tooltip(CHRONOS_TOOL),
      },
    });
    setIcon(chronosBtn, "hourglass");
    chronosBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
    chronosBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.onChronos();
    });
    this.chronosBtn = chronosBtn;

    const outlineBtn = this.el.createEl("button", {
      type: "button",
      cls: "jce-tool jce-tool-outline",
      attr: {
        "data-tool": "outline",
        "aria-label": tooltip(OUTLINE_TOOL),
      },
    });
    setIcon(outlineBtn, "list");
    outlineBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
    outlineBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.onOutline();
    });
    this.outlineBtn = outlineBtn;

    this.setActive("select");
  }

  setActive(id: ToolId | null): void {
    this.current = id;
    this.el.querySelectorAll<HTMLElement>(".jce-tool").forEach((btn) => {
      if (
        btn === this.searchBtn ||
        btn === this.minimapBtn ||
        btn === this.chronosBtn ||
        btn === this.outlineBtn
      ) {
        return;
      }
      btn.classList.toggle("is-active", btn.dataset.tool === id);
    });
  }

  setSearchActive(active: boolean): void {
    this.searchBtn.classList.toggle("is-active", active);
  }

  setMinimapActive(active: boolean): void {
    this.minimapBtn.classList.toggle("is-active", active);
  }

  setChronosActive(active: boolean): void {
    this.chronosBtn.classList.toggle("is-active", active);
  }

  setOutlineActive(active: boolean): void {
    this.outlineBtn.classList.toggle("is-active", active);
  }

  getActive(): ToolId | null {
    return this.current;
  }

  detach(): void {
    this.el.remove();
  }
}
