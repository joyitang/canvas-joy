/**
 * Canvas 增强 — Obsidian Canvas enhancement.
 *
 * Rebuilt against the PRD (Canvas增强-PRD-Gemini.md) and against the actual
 * Obsidian 1.15 Canvas internals; see bridge.ts for the verified assumptions.
 */

import { FileView, Plugin, Scope, TFile, WorkspaceLeaf } from "obsidian";
import {
  CanvasLike,
  NodeLike,
  Point,
  commit,
  deleteNodes,
  isEditing,
  isInsideCanvasUi,
  selectedNodes,
  viewportCenter,
} from "./bridge";
import { AlignBar, applyAlignment } from "./align";
import { EdgeAnchorsController } from "./anchors";
import { Chrome } from "./chrome";
import { ChronosController } from "./chronos";
import { CardCollapseController } from "./collapse";
import { ConnectTool } from "./connect";
import { FocusController } from "./focus";
import { CanvasPngExporter } from "./export";
import { FormatBar } from "./format";
import { MinimapController } from "./minimap";
import { CanvasToolbar } from "./toolbar";
import { ContextMenus } from "./menus";
import { MindmapController } from "./mindmap";
import { createObject, tag } from "./objects";
import { SectionOutlineController } from "./outline";
import { OutlinePrefs } from "./outline-sort";
import { PdfPasteController } from "./pdf-paste";
import { CanvasSearchBar } from "./search";
import { TodoController } from "./todo";
import { ZoomLodController } from "./zoomlod";
import { AlignOp, DEFAULTS, ToolId, TOOLS } from "./copy";
import { Kind, isMindmap, kindOf, rootIdOf, treeOf, descendantsOf, CARD_BG } from "./model";
import { KIND_SIZE, rectOf, unionRect } from "./layout";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  c: "connect",
  n: "note",
  t: "text",
  m: "mindmap",
  g: "section",
  d: "todo",
};

export default class CanvasEnhancePlugin extends Plugin {
  private chrome!: Chrome;
  private mindmap!: MindmapController;
  private formats!: FormatBar;
  private connect!: ConnectTool;
  private menus!: ContextMenus;
  private todo!: TodoController;
  private search!: CanvasSearchBar;
  private focus!: FocusController;
  private collapse!: CardCollapseController;
  private zoomLod!: ZoomLodController;
  private align!: AlignBar;
  private minimap!: MinimapController;
  private anchors!: EdgeAnchorsController;
  private chronos!: ChronosController;
  private outline!: SectionOutlineController;
  private pdfPaste!: PdfPasteController;
  private exporter!: CanvasPngExporter;
  private keyScope: Scope | null = null;
  private prefs: { minimapOpen?: boolean; outlines?: Record<string, OutlinePrefs> } = {};

  private toolbars = new Map<CanvasLike, CanvasToolbar>();
  private placing: { canvas: CanvasLike; kind: Kind; text?: string } | null = null;
  private blankDown: { canvas: CanvasLike; x: number; y: number } | null = null;
  private hookedDocs = new WeakSet<Document>();
  private frameHooks = new WeakSet<CanvasLike>();

  async onload(): Promise<void> {
    this.prefs =
      ((await this.loadData()) as {
        minimapOpen?: boolean;
        outlines?: Record<string, OutlinePrefs>;
      } | null) ?? {};
    if (!this.prefs.outlines) this.prefs.outlines = {};
    this.collapse = new CardCollapseController();
    this.zoomLod = new ZoomLodController();
    this.focus = new FocusController();
    this.align = new AlignBar({
      onAlign: (canvas, op) => this.alignSelection(canvas, op),
      isSuppressed: (canvas) => this.search.isOpen(canvas) || this.focus.isActive(canvas),
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
      },
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
      this.outline.sync(canvas);
    });
    this.mindmap = new MindmapController(this, this.chrome);
    this.formats = new FormatBar(this);
    this.todo = new TodoController(this);
    this.connect = new ConnectTool(this);
    this.anchors = new EdgeAnchorsController(this);
    this.chronos = new ChronosController(this, {
      onActiveChange: (canvas, active) => {
        this.toolbars.get(canvas)?.setChronosActive(active);
      },
    });
    this.outline = new SectionOutlineController({
      getFilePath: (canvas) => this.canvasFilePath(canvas),
      getPrefs: (filePath) => this.prefs.outlines?.[filePath] ?? {},
      setPrefs: (filePath, next) => {
        if (!this.prefs.outlines) this.prefs.outlines = {};
        this.prefs.outlines[filePath] = next;
        void this.saveData(this.prefs);
      },
      onOpenChange: (canvas, open) => {
        this.toolbars.get(canvas)?.setOutlineActive(open);
      },
    });
    this.pdfPaste = new PdfPasteController(this.chrome);
    this.exporter = new CanvasPngExporter();
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
      },
      exportPng: (canvas, targetNodes) => {
        const file = this.canvasFile(canvas);
        const isPartial = Array.isArray(targetNodes) && targetNodes.length > 0;
        void this.exporter.exportPng(canvas, {
          targetNodes,
          fileName: file ? (isPartial ? `${file.basename}-part` : file.basename) : undefined,
        });
      },
    });

    this.registerEvent(this.app.workspace.on("layout-change", () => this.sync()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.sync()));
    this.registerEvent(this.app.workspace.on("file-open", () => window.setTimeout(() => this.sync(), 60)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.prefs.outlines && this.prefs.outlines[oldPath]) {
          this.prefs.outlines[file.path] = this.prefs.outlines[oldPath];
          delete this.prefs.outlines[oldPath];
          void this.saveData(this.prefs);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.prefs.outlines && this.prefs.outlines[file.path]) {
          delete this.prefs.outlines[file.path];
          void this.saveData(this.prefs);
        }
      })
    );

    this.registerDomEvent(window, "keydown", (evt) => this.onKey(evt), true);
    this.registerDomEvent(
      window,
      "paste",
      (evt: ClipboardEvent) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return;
        this.pdfPaste.onCanvasPaste(evt, canvas, isTyping(evt.target));
      },
      true
    );

    // Official Obsidian Scope runs ahead of built-in hotkeys (e.g. ⌘G Graph View)
    // so ⌘G and ⌘F work seamlessly on Canvas while falling through elsewhere.
    const scope = new Scope(this.app.scope);
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
    scope.register(["Mod", "Shift"], "o", (evt) => {
      const canvas = activeCanvas(this.app);
      if (!canvas || isTyping(evt.target)) return;
      this.outline.toggle(canvas);
      return false;
    });
    this.app.keymap.pushScope(scope);
    this.keyScope = scope;
    // Window capture: a preview checkbox must win over the canvas node
    // selection, which would otherwise swallow the click.
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
          const target = evt.target as Element | null;
          if (
            canvas &&
            this.focus.isActive(canvas) &&
            target &&
            canvas.wrapperEl.contains(target) &&
            !target.closest(".canvas-node") &&
            !isInsideCanvasUi(target)
          ) {
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
      name: "新建分区 / Create section",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.groupSelection(canvas);
        return true;
      },
    });

    this.addCommand({
      id: "search-canvas",
      name: "画布内搜索 / Search in canvas",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.search.open(canvas);
        return true;
      },
    });

    this.addCommand({
      id: "toggle-focus-mode",
      name: "切换聚焦模式 / Toggle focus mode",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!this.focus.isActive(canvas) && !selectedNodes(canvas).length) return false;
        if (!checking) this.focus.toggle(canvas);
        return true;
      },
    });

    this.addCommand({
      id: "group-selection-into-section",
      name: "框选打包进分区 / Group selection into section",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.groupSelection(canvas);
        return true;
      },
    });

    this.addCommand({
      id: "toggle-minimap",
      name: "切换小地图 / Toggle minimap",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.minimap.toggle(this.toolbars.keys());
        return true;
      },
    });

    this.addCommand({
      id: "toggle-chronos",
      name: "切换时间轴 / Toggle Chronos timeline",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.chronos.toggle(canvas);
        return true;
      },
    });

    this.addCommand({
      id: "toggle-section-outline",
      name: "切换分区大纲 / Toggle section outline",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) this.outline.toggle(canvas);
        return true;
      },
    });

    this.addCommand({
      id: "export-canvas-png",
      name: "导出画布为 PNG / Export canvas as PNG",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) {
          const file = this.canvasFile(canvas);
          void this.exporter.exportPng(canvas, {
            selectionOnly: false,
            fileName: file?.basename,
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "export-selection-png",
      name: "导出选中区域为 PNG / Export selection as PNG",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas || !selectedNodes(canvas).length) return false;
        if (!checking) {
          const file = this.canvasFile(canvas);
          void this.exporter.exportPng(canvas, {
            selectionOnly: true,
            fileName: file ? `${file.basename}-selection` : undefined,
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "add-mindmap-child",
      name: "新建导图子节点 / Add mindmap child",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        const node = this.activeMindmapNode(canvas);
        if (!node) return false;
        if (!checking) this.mindmap.addChild(canvas, node.id);
        return true;
      },
    });

    this.sync();
  }

  onunload(): void {
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
    this.outline.destroy();
    for (const canvas of this.toolbars.keys()) {
      this.collapse.detach(canvas);
      this.zoomLod.detach(canvas);
      this.anchors.detach(canvas);
      this.chronos.detach(canvas);
      this.outline.detach(canvas);
      this.chrome.detach(canvas);
    }
    for (const bar of this.toolbars.values()) bar.detach();
    this.toolbars.clear();
  }

  // ------------------------------------------------------------- lifecycle

  private sync(): void {
    const seen = new Set<CanvasLike>();
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      const canvas = canvasOf(leaf);
      if (!canvas || seen.has(canvas)) continue;
      seen.add(canvas);
      this.chrome.attach(canvas);
      this.anchors.attach(canvas);
      this.ensureToolbar(leaf, canvas);
      this.outline.sync(canvas);
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
      this.outline.detach(canvas);
      this.chrome.detach(canvas);
      this.toolbars.delete(canvas);
    }
  }

  private ensureToolbar(leaf: WorkspaceLeaf, canvas: CanvasLike): void {
    const host = (leaf.view as { contentEl?: HTMLElement }).contentEl;
    if (!host) return;
    const existing = this.toolbars.get(canvas);
    if (existing && host.contains(existing.el)) return;
    existing?.detach();
    const bar = new CanvasToolbar(
      (tool) => this.onTool(canvas, tool),
      () => this.search.toggle(canvas),
      () => this.minimap.toggle(this.toolbars.keys()),
      () => this.chronos.toggle(canvas),
      () => this.outline.toggle(canvas)
    );
    bar.setMinimapActive(this.minimap.isOpen());
    bar.setChronosActive(this.chronos.isActive(canvas));
    bar.setOutlineActive(this.outline.isOpen(canvas));
    host.appendChild(bar.el);
    this.toolbars.set(canvas, bar);
  }

  private canvasFile(canvas: CanvasLike): TFile | null {
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      if (canvasOf(leaf) === canvas) {
        const file = (leaf.view as { file?: TFile | null }).file;
        return file ?? null;
      }
    }
    return null;
  }

  private canvasFilePath(canvas: CanvasLike): string | null {
    return this.canvasFile(canvas)?.path ?? null;
  }

  /** Keep the overlay honest while nodes are being dragged. */
  private patchFrame(canvas: CanvasLike): void {
    if (this.frameHooks.has(canvas)) return;
    this.frameHooks.add(canvas);
    const original = canvas.requestFrame.bind(canvas);
    canvas.requestFrame = () => {
      original();
      this.chrome.schedule(canvas);
      this.minimap.sync(canvas);
      this.outline.sync(canvas);
    };
  }

  /** Hooking iframes lets Tab create children while the caret is inside one. */
  private hookFrames(canvas: CanvasLike): void {
    this.formats.hookCanvas(canvas);
    for (const node of canvas.nodes.values()) {
      node.nodeEl.querySelectorAll("iframe").forEach((frame) => {
        let doc: Document | null = null;
        try {
          doc = frame.contentDocument;
        } catch {
          return;
        }
        if (!doc || this.hookedDocs.has(doc)) return;
        this.hookedDocs.add(doc);
        this.pdfPaste.hookEditorDoc(doc);
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

  private onPointerMove(evt: PointerEvent): void {
    if (evt.buttons === 0) return;
    const canvas = activeCanvas(this.app);
    if (canvas) this.chrome.schedule(canvas);
  }

  private syncSelectionChrome(): void {
    const canvas = activeCanvas(this.app);
    if (canvas) this.chrome.schedule(canvas);
  }

  // ----------------------------------------------------------------- tools

  private onTool(canvas: CanvasLike, tool: ToolId): void {
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
      // A to-do is a note card that starts life as one empty task.
      this.setPlacing({ canvas, kind: "note", text: DEFAULTS.todo });
      return;
    }
    this.setPlacing({ canvas, kind: tool });
  }

  private setPlacing(next: { canvas: CanvasLike; kind: Kind; text?: string } | null): void {
    if (this.placing) this.placing.canvas.wrapperEl.classList.remove("jce-placing");
    this.placing = next;
    if (next) next.canvas.wrapperEl.classList.add("jce-placing");
  }

  private onPlaceClick(evt: PointerEvent): void {
    const placing = this.placing;
    if (!placing) return;
    if (evt.button !== 0) return;
    if (!placing.canvas.wrapperEl.contains(evt.target as Node)) return;
    if (isInsideCanvasUi(evt.target as Element)) return;
    evt.preventDefault();
    evt.stopPropagation();

    const at = placing.canvas.posFromEvt(evt);
    createObject(this.chrome, {
      canvas: placing.canvas,
      kind: placing.kind,
      at,
      text: placing.text,
      caretAtEnd: !!placing.text,
    });
    this.setPlacing(null);
    this.setActive(placing.canvas, "select");
  }

  private setActive(canvas: CanvasLike, tool: ToolId): void {
    this.toolbars.get(canvas)?.setActive(tool);
  }

  // -------------------------------------------------------------- keyboard

  private onKey(evt: KeyboardEvent): void {
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
      if (this.outline.isOpen(canvas) && !isTyping(evt.target)) {
        evt.preventDefault();
        evt.stopPropagation();
        this.outline.close(canvas);
        return;
      }
      this.setPlacing(null);
      this.connect.exit();
      this.formats.hide();
      this.setActive(canvas, "select");
      return;
    }

    if (evt.metaKey || evt.ctrlKey) {
      if (evt.shiftKey && !evt.altKey && evt.key.toLowerCase() === "o") {
        if (isTyping(evt.target)) return;
        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
        this.outline.toggle(canvas);
        return;
      }
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
      if (isTyping(evt.target)) return; // the iframe hook handles that case
      const node = this.activeMindmapNode(canvas);
      if (!node) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.mindmap.addChild(canvas, node.id);
      return;
    }

    // TOOL-01: typing must never be hijacked by tool shortcuts.
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
      const kind: Kind = tool === "todo" ? "note" : tool;
      createObject(this.chrome, {
        canvas,
        kind,
        at: viewportCenter(canvas, KIND_SIZE[kind]),
        text: tool === "todo" ? DEFAULTS.todo : undefined,
        caretAtEnd: tool === "todo",
      });
      this.setActive(canvas, "select");
    }
  }

  /**
   * The mindmap node Tab applies to. Dragging pre-selects a whole subtree, so
   * with several nodes selected we take the topmost one (the one that is not a
   * descendant of another selected node) — that is the node the user clicked.
   */
  private activeMindmapNode(canvas: CanvasLike): NodeLike | undefined {
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
    return undefined;
  }

  // --------------------------------------------------------------- actions

  private setColor(canvas: CanvasLike, nodeId: string, color: string): void {
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
  private setCardBg(canvas: CanvasLike, nodeId: string, color: string): void {
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
  private groupSelection(canvas: CanvasLike, fallbackNode?: NodeLike): void {
    const sel = selectedNodes(canvas).filter(
      (n) => !n.nodeEl.classList.contains("jce-sec-hidden")
    );
    let targets: NodeLike[];
    if (fallbackNode) {
      targets = sel.some((n) => n.id === fallbackNode.id) ? sel : [fallbackNode];
    } else {
      targets = sel;
    }

    if (!targets.length) {
      createObject(this.chrome, {
        canvas,
        kind: "section",
        at: viewportCenter(canvas, KIND_SIZE.section),
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
        height: Math.round(box.height + padTop + padBottom),
      },
      label: DEFAULTS.section,
      focus: false,
      save: true,
    });
    if (!group) return;
    tag(canvas, group, "section");
    commit(canvas);
    this.chrome.invalidate(canvas);
    canvas.selectOnly(group);
  }

  private alignSelection(canvas: CanvasLike, op: AlignOp): void {
    if (applyAlignment(canvas, op)) {
      this.chrome.invalidate(canvas);
      this.minimap.sync(canvas);
    }
  }

  private removeNode(canvas: CanvasLike, nodeId: string): void {
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
}

// ------------------------------------------------------------------ helpers

function canvasOf(leaf: WorkspaceLeaf): CanvasLike | null {
  const view = leaf.view as { canvas?: CanvasLike };
  return view.canvas ?? null;
}

function activeCanvas(app: Plugin["app"]): CanvasLike | null {
  const view = app.workspace.getActiveViewOfType(FileView);
  if (!view || view.getViewType() !== "canvas") return null;
  return (view as unknown as { canvas?: CanvasLike }).canvas ?? null;
}

function nodeById(canvas: CanvasLike, id: string): NodeLike | undefined {
  return canvas.nodes.get(id);
}

function isTyping(target: EventTarget | null): boolean {
  if (document.activeElement instanceof HTMLIFrameElement) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "IFRAME") return true;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!target.closest(".cm-editor, .cm-content");
}

export { TOOLS };
export type { Point };
