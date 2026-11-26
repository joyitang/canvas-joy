/**
 * export.ts — High-resolution PNG export for Obsidian Canvas.
 *
 * Design:
 *  - Exports either the full visible canvas or the current selection, bounded
 *    by the tightest world-space bounding box plus uniform padding.
 *  - Follows the active Obsidian theme (light/dark) with a clean solid
 *    background (dots/grid hidden), or optional transparent background.
 *  - Renders at 2x resolution by default, automatically scaling down if the
 *    target dimensions exceed safe memory/canvas limits.
 *  - Strips interactive UI chrome (selection rings, resize handles, anchors,
 *    zoom-LOD overlays) and inlines stylesheets + images so SVG <foreignObject>
 *    rasterization never taints the output canvas.
 */

import { Menu, Notice, TFile } from "obsidian";
import { BBox, CanvasLike, NodeLike, allNodes, scaleOf, selectedNodes } from "./bridge";
import { isGroupNode, nodesInsideGroup } from "./model";

const PADDING = 64;
const DEFAULT_SCALE = 2;
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_PIXELS = 40_000_000;
const SECTION_LABEL_HEADROOM = 32;

export interface ExportOptions {
  selectionOnly?: boolean;
  targetNodes?: NodeLike[];
  transparent?: boolean;
  scale?: number;
  fileName?: string;
}

export class CanvasPngExporter {
  private transparentBg = false;
  private exporting = false;

  /** Show a compact export menu anchored to a button or mouse event. */
  openMenu(canvas: CanvasLike, anchor: HTMLElement | MouseEvent, file?: TFile | null): void {
    const sel = selectedNodes(canvas).filter((n) => this.isNodeVisible(n));
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle("导出整个画布 (PNG) / Export full canvas")
        .setIcon("image")
        .onClick(() => {
          void this.exportPng(canvas, {
            selectionOnly: false,
            transparent: this.transparentBg,
            fileName: file?.basename,
          });
        })
    );

    if (sel.length > 0) {
      menu.addItem((item) =>
        item
          .setTitle(`导出选中区域 (${sel.length}) / Export selection`)
          .setIcon("scan")
          .onClick(() => {
            void this.exportPng(canvas, {
              selectionOnly: true,
              transparent: this.transparentBg,
              fileName: file?.basename ? `${file.basename}-selection` : undefined,
            });
          })
      );
    }

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("透明背景 / Transparent background")
        .setChecked(this.transparentBg)
        .onClick(() => {
          this.transparentBg = !this.transparentBg;
        })
    );

    if (anchor instanceof MouseEvent) {
      menu.showAtMouseEvent(anchor);
    } else {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right + 6, y: rect.top });
    }
  }

  async exportPng(canvas: CanvasLike, opts: ExportOptions = {}): Promise<void> {
    if (this.exporting) {
      new Notice("正在导出图片，请稍候…");
      return;
    }

    const hasExplicitTargets = Array.isArray(opts.targetNodes) && opts.targetNodes.length > 0;
    const isPartial = opts.selectionOnly === true || hasExplicitTargets;
    const targets = this.collectTargetNodes(canvas, opts);
    if (targets.length === 0) {
      new Notice(isPartial ? "没有可导出的选中元素" : "画布为空，无法导出");
      return;
    }

    this.exporting = true;
    const notice = new Notice("正在生成高清 PNG…", 0);

    try {
      const bbox = this.computeBBox(targets);
      const worldX = bbox.minX - PADDING;
      const worldY = bbox.minY - PADDING;
      const worldW = Math.max(1, bbox.maxX - bbox.minX + PADDING * 2);
      const worldH = Math.max(1, bbox.maxY - bbox.minY + PADDING * 2);

      const requestedScale = opts.scale ?? DEFAULT_SCALE;
      const safeScale = this.clampScale(worldW, worldH, requestedScale);
      if (safeScale < requestedScale - 0.05) {
        new Notice(
          `画布尺寸较大，已自动调整为 ${safeScale.toFixed(2)}x 分辨率导出以防止内存溢出`,
          4000
        );
      }

      const outW = Math.round(worldW * safeScale);
      const outH = Math.round(worldH * safeScale);

      // If the canvas is currently zoomed way out, Obsidian unmounts card DOM content.
      // Temporarily zoom to 1x so cards mount cleanly, then restore immediately.
      const restored = await this.ensureNormalZoom(canvas, bbox);

      let clonedWorld: HTMLElement;
      try {
        clonedWorld = await this.buildClonedWorld(
          canvas,
          targets,
          worldX,
          worldY,
          worldW,
          worldH,
          isPartial
        );
      } finally {
        if (restored) restored();
      }

      const bgColor = opts.transparent ? "transparent" : this.resolveThemeBg(canvas);
      const cssText = this.collectStylesText(canvas);
      const rootClasses = this.collectRootClasses(canvas);

      const svgMarkup = this.buildForeignObjectSvg(
        clonedWorld,
        cssText,
        rootClasses,
        bgColor,
        worldW,
        worldH
      );

      const blob = await this.rasterizeSvgToPng(svgMarkup, worldW, worldH, outW, outH, bgColor);
      const name = `${opts.fileName || "canvas"}-${this.timestamp()}.png`;
      this.triggerDownload(blob, name);
      new Notice(`已导出 ${name} (${outW}×${outH})`, 3000);
    } catch (err) {
      console.error("[canvas-joy] PNG export failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`导出 PNG 失败：${msg.slice(0, 80)}`, 5000);
    } finally {
      notice.hide();
      this.exporting = false;
    }
  }

  // ------------------------------------------------------------------ targets

  private isNodeVisible(node: NodeLike): boolean {
    const el = node.nodeEl;
    if (!el) return false;
    if (el.style.display === "none") return false;
    if (el.classList.contains("jce-sec-hidden") || el.classList.contains("jce-hidden")) {
      return false;
    }
    return true;
  }

  private collectTargetNodes(canvas: CanvasLike, opts: ExportOptions): NodeLike[] {
    if (opts.targetNodes && opts.targetNodes.length > 0) {
      return this.expandWithGroupChildren(canvas, opts.targetNodes).filter((n) =>
        this.isNodeVisible(n)
      );
    }
    if (opts.selectionOnly) {
      return this.expandWithGroupChildren(canvas, selectedNodes(canvas)).filter((n) =>
        this.isNodeVisible(n)
      );
    }
    return allNodes(canvas).filter((n) => this.isNodeVisible(n));
  }

  /** When a Section (group) is targeted, include all visible nodes inside it. */
  private expandWithGroupChildren(canvas: CanvasLike, seeds: NodeLike[]): NodeLike[] {
    const out: NodeLike[] = [];
    const seen = new Set<string>();
    const push = (n: NodeLike) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      out.push(n);
    };
    for (const node of seeds) {
      push(node);
      if (isGroupNode(node)) {
        for (const inside of nodesInsideGroup(canvas, node)) {
          push(inside);
        }
      }
    }
    return out;
  }

  private computeBBox(nodes: NodeLike[]): BBox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of nodes) {
      const isGroup = n.getData().type === "group";
      const topExtra = isGroup ? SECTION_LABEL_HEADROOM : 0;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y - topExtra);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    return { minX, minY, maxX, maxY };
  }

  private clampScale(w: number, h: number, desired: number): number {
    const bySide = Math.min(MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h);
    const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
    return Math.max(0.25, Math.min(desired, bySide, byArea));
  }

  // ------------------------------------------------------------------ zoom guard

  private async ensureNormalZoom(
    canvas: CanvasLike,
    bbox: BBox
  ): Promise<(() => void) | null> {
    const curScale = scaleOf(canvas);
    const wasZoomedOut =
      curScale < 0.5 || canvas.wrapperEl.classList.contains("mod-zoomed-out");
    if (!wasZoomedOut || !canvas.setViewport) return null;

    const prevX = canvas.x ?? 0;
    const prevY = canvas.y ?? 0;
    const prevZoom = curScale;
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;

    canvas.setViewport(cx, cy, 1);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => window.setTimeout(resolve, 90));
    });

    return () => {
      canvas.setViewport?.(prevX, prevY, prevZoom);
    };
  }

  // ------------------------------------------------------------------ DOM clone

  private async buildClonedWorld(
    canvas: CanvasLike,
    targets: NodeLike[],
    worldX: number,
    worldY: number,
    worldW: number,
    worldH: number,
    selectionOnly: boolean
  ): Promise<HTMLElement> {
    const targetIds = new Set(targets.map((n) => n.id));
    const stage = document.createElement("div");
    stage.className = "canvas-wrapper jce-export-stage";
    stage.style.cssText = [
      "position: relative",
      `width: ${worldW}px`,
      `height: ${worldH}px`,
      "overflow: hidden",
      "background: transparent",
      "pointer-events: none",
    ].join(";");

    const world = document.createElement("div");
    world.className = "canvas";
    world.style.cssText = [
      "position: absolute",
      `left: ${-worldX}px`,
      `top: ${-worldY}px`,
      "transform: none",
      "transform-origin: 0 0",
    ].join(";");

    // 1. Copy mindmap overlay & native edge SVG layers in world coordinates.
    for (const child of Array.from(canvas.canvasEl.children)) {
      if (child instanceof SVGSVGElement) {
        if (selectionOnly && !child.classList.contains("jce-overlay")) {
          // Keep edges that connect two selected nodes; drop unrelated ones.
          const svgClone = child.cloneNode(true) as SVGSVGElement;
          this.filterSelectionEdges(canvas, svgClone, targetIds);
          world.appendChild(svgClone);
        } else {
          const svgClone = child.cloneNode(true) as SVGSVGElement;
          this.inlineSvgOverlayVars(child, svgClone);
          world.appendChild(svgClone);
        }
      }
    }

    // 2. Copy target node elements cleanly.
    for (const node of targets) {
      const clone = node.nodeEl.cloneNode(true) as HTMLElement;
      clone.classList.remove("is-focused", "is-selected");
      clone
        .querySelectorAll(
          ".jce-lod-overlay, .jce-anchor, .canvas-node-resizer, .canvas-node-connection-point"
        )
        .forEach((el) => el.remove());

      // Ensure explicit world position & size in case Obsidian uses CSS vars or transform.
      if (!clone.style.transform && !clone.style.left) {
        clone.style.transform = `translate(${node.x}px, ${node.y}px)`;
      }
      clone.style.width = `${node.width}px`;
      clone.style.height = `${node.height}px`;

      await this.inlineEmbeddedMedia(node.nodeEl, clone);
      world.appendChild(clone);
    }

    stage.appendChild(world);
    return stage;
  }

  private inlineSvgOverlayVars(orig: SVGSVGElement, clone: SVGSVGElement): void {
    const cs = getComputedStyle(orig);
    const left = orig.style.getPropertyValue("--jce-ov-left") || cs.getPropertyValue("--jce-ov-left");
    const top = orig.style.getPropertyValue("--jce-ov-top") || cs.getPropertyValue("--jce-ov-top");
    const w = orig.style.getPropertyValue("--jce-ov-w") || cs.getPropertyValue("--jce-ov-w");
    const h = orig.style.getPropertyValue("--jce-ov-h") || cs.getPropertyValue("--jce-ov-h");
    const props: Record<string, string> = {};
    if (left) props.left = left;
    if (top) props.top = top;
    if (w) props.width = w;
    if (h) props.height = h;
    if (orig.classList.contains("jce-overlay")) {
      props.position = "absolute";
      props.overflow = "visible";
    }
    if (Object.keys(props).length > 0) {
      clone.setCssProps(props);
    }
  }

  private filterSelectionEdges(
    canvas: CanvasLike,
    svgClone: SVGSVGElement,
    selectedIds: Set<string>
  ): void {
    // Best-effort: if edge elements carry data-edge-id or match hidden edges, prune edges
    // whose endpoints are not both in selectedIds.
    const validEdgeIds = new Set<string>();
    for (const edge of canvas.edges.values()) {
      if (selectedIds.has(edge.from.node.id) && selectedIds.has(edge.to.node.id)) {
        validEdgeIds.add(edge.id);
      }
    }
    if (validEdgeIds.size === 0) {
      svgClone.replaceChildren();
      return;
    }
    svgClone.querySelectorAll("[data-edge-id]").forEach((el) => {
      const id = el.getAttribute("data-edge-id");
      if (id && !validEdgeIds.has(id)) el.remove();
    });
  }

  private async inlineEmbeddedMedia(origRoot: HTMLElement, cloneRoot: HTMLElement): Promise<void> {
    // Convert <canvas> elements to <img> so bitmaps survive SVG serialization.
    const origCanvases = Array.from(origRoot.querySelectorAll("canvas"));
    const cloneCanvases = Array.from(cloneRoot.querySelectorAll("canvas"));
    for (let i = 0; i < origCanvases.length && i < cloneCanvases.length; i++) {
      try {
        const dataUrl = origCanvases[i].toDataURL("image/png");
        const img = document.createElement("img");
        img.src = dataUrl;
        img.style.cssText = cloneCanvases[i].style.cssText;
        img.width = origCanvases[i].width;
        img.height = origCanvases[i].height;
        cloneCanvases[i].replaceWith(img);
      } catch {
        // Ignore tainted sub-canvases
      }
    }

    // Inline <img> sources as data URLs so Chromium never taints the output canvas.
    const origImgs = Array.from(origRoot.querySelectorAll("img"));
    const cloneImgs = Array.from(cloneRoot.querySelectorAll("img"));
    await Promise.all(
      cloneImgs.map(async (img, idx) => {
        const src = img.getAttribute("src");
        if (!src || src.startsWith("data:")) return;
        let dataUrl = await this.toDataUrl(src);
        if (!dataUrl && origImgs[idx]) {
          dataUrl = this.imgElementToDataUrl(origImgs[idx]);
        }
        if (dataUrl) {
          img.setAttribute("src", dataUrl);
        } else {
          // Never leave an external/app:// URL inside <foreignObject>, or toBlob() will taint.
          img.removeAttribute("src");
        }
      })
    );
  }

  private imgElementToDataUrl(img: HTMLImageElement): string | null {
    try {
      if (!img.complete || img.naturalWidth === 0) return null;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      return c.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  private async toDataUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ CSS & SVG

  private resolveThemeBg(canvas: CanvasLike): string {
    const wrapperBg = getComputedStyle(canvas.wrapperEl).backgroundColor;
    if (wrapperBg && wrapperBg !== "rgba(0, 0, 0, 0)" && wrapperBg !== "transparent") {
      return wrapperBg;
    }
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    if (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent") {
      return bodyBg;
    }
    return document.body.classList.contains("theme-dark") ? "#1e1e1e" : "#ffffff";
  }

  private collectRootClasses(canvas: CanvasLike): string {
    const bodyCls = document.body.className;
    const wrapperCls = canvas.wrapperEl.className
      .split(/\s+/)
      .filter((c) => c && c !== "mod-zoomed-out" && c !== "jce-zoom-far")
      .join(" ");
    return `${bodyCls} ${wrapperCls}`.trim();
  }

  private collectStylesText(canvas: CanvasLike): string {
    const chunks: string[] = [];

    // Copy active CSS variables from :root and body so themes/custom CSS apply inside SVG.
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const varDecls: string[] = [];
    for (const styleObj of [rootStyle, bodyStyle]) {
      for (let i = 0; i < styleObj.length; i++) {
        const prop = styleObj[i];
        if (prop.startsWith("--")) {
          const val = styleObj.getPropertyValue(prop);
          if (val) varDecls.push(`${prop}:${val};`);
        }
      }
    }
    if (varDecls.length > 0) {
      chunks.push(`:root, body { ${varDecls.join("")} }`);
    }

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        for (let i = 0; i < rules.length; i++) {
          const text = rules[i].cssText;
          // Skip @font-face (external app:// fonts taint SVG <foreignObject> canvas)
          if (text.startsWith("@font-face")) continue;
          chunks.push(this.stripExternalCssUrls(text));
        }
      } catch {
        // Cross-origin stylesheet; skip safely
      }
    }

    // Export overrides: hide background dots/grid and interactive focus chrome.
    const wrapperBg = this.resolveThemeBg(canvas);
    chunks.push(`
      html, body, .jce-export-stage {
        margin: 0 !important;
        padding: 0 !important;
        background-image: none !important;
        background-color: transparent !important;
      }
      .canvas-background { display: none !important; }
      .canvas-node.is-focused .canvas-node-container {
        box-shadow: var(--shadow-s, 0 1px 3px rgba(0,0,0,0.08)) !important;
      }
      .jce-export-root {
        background-color: ${wrapperBg};
      }
    `);

    return chunks.join("\n");
  }

  private stripExternalCssUrls(css: string): string {
    return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, _q, target: string) => {
      const t = target.trim();
      if (t.startsWith("data:") || t.startsWith("#")) return match;
      return "none";
    });
  }

  private buildForeignObjectSvg(
    stageEl: HTMLElement,
    cssText: string,
    rootClasses: string,
    bgColor: string,
    w: number,
    h: number
  ): string {
    const serializer = new XMLSerializer();
    const stageXhtml = serializer.serializeToString(stageEl);

    // SVG is parsed as strict XML: CSS rules contain `>`, `<`, `&`, etc.,
    // so <style> must be wrapped in CDATA.
    const safeCss = cssText.replace(/\]\]>/g, "]]]]><![CDATA[>");
    const bgStyle =
      bgColor === "transparent"
        ? "background: transparent;"
        : `background-color: ${bgColor};`;

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
      `<foreignObject x="0" y="0" width="${w}" height="${h}">`,
      `<div xmlns="http://www.w3.org/1999/xhtml" class="${this.escapeAttr(rootClasses)}" style="width:${w}px;height:${h}px;overflow:hidden;${bgStyle}">`,
      `<style>/*<![CDATA[*/\n${safeCss}\n/*]]>*/</style>`,
      stageXhtml,
      `</div>`,
      `</foreignObject>`,
      `</svg>`,
    ].join("");
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  private async rasterizeSvgToPng(
    svgMarkup: string,
    worldW: number,
    worldH: number,
    outW: number,
    outH: number,
    bgColor: string
  ): Promise<Blob> {
    // Use data: URL (not blob: URL) so Chromium treats <foreignObject> as untainted
    // as long as all embedded resources are data: URLs.
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("SVG 图像解析失败（可能是样式或嵌入资源格式异常）"));
      el.src = url;
    });

    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");

    if (bgColor !== "transparent") {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, outW, outH);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, worldW, worldH, 0, 0, outW, outH);

    return await new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob returned null"));
      }, "image/png");
    });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  private timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
}
