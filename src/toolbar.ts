/**
 * toolbar.ts — the Heptabase-style tool bar.
 *
 * Order follows the confirmed wording in PRD §4.2: Section is the entry
 * directly below Mindmap ("第一排、思维导图下面"). The exact pixel layout still
 * needs the original confirmation image, so this keeps the old vertical
 * arrangement rather than inventing a grid.
 */

import { setIcon } from "obsidian";
import { SEARCH_TOOL, TOOLS, ToolId, tooltip } from "./copy";
import { ICONS } from "./icons";

export class CanvasToolbar {
  el: HTMLElement;
  private current: ToolId | null = "select";
  private searchBtn: HTMLButtonElement;

  constructor(
    private onPick: (id: ToolId) => void,
    private onSearch: () => void
  ) {
    this.el = document.createElement("div");
    this.el.className = "jce-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Canvas 增强");

    const order: ToolId[] = ["select", "connect", "note", "text", "todo", "mindmap", "section"];
    order.forEach((id, index) => {
      if (index === 2) {
        const sep = document.createElement("div");
        sep.className = "jce-tool-sep";
        this.el.appendChild(sep);
      }
      const meta = TOOLS[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "jce-tool";
      btn.dataset.tool = id;
      btn.title = tooltip(meta);
      btn.setAttribute("aria-label", tooltip(meta));
      btn.innerHTML = ICONS[id] ?? "";
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.onPick(id);
      });
      this.el.appendChild(btn);
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

    this.setActive("select");
  }

  setActive(id: ToolId | null): void {
    this.current = id;
    this.el.querySelectorAll<HTMLElement>(".jce-tool").forEach((btn) => {
      if (btn === this.searchBtn) return;
      btn.classList.toggle("is-active", btn.dataset.tool === id);
    });
  }

  setSearchActive(active: boolean): void {
    this.searchBtn.classList.toggle("is-active", active);
  }

  getActive(): ToolId | null {
    return this.current;
  }

  detach(): void {
    this.el.remove();
  }
}
