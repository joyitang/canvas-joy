/**
 * minimap.ts — Heptabase-style whiteboard minimap.
 *
 * Hidden by default (toggled from the toolbar or command palette, persisted
 * across sessions). Renders all visible groups and cards onto a HiDPI canvas
 * in the bottom-right corner and lets the user click or drag to navigate.
 */

import { setIcon } from "obsidian";
import { CanvasLike, allNodes } from "./bridge";
import { cardBgOf, isGroupNode, isMindmap, kindOf } from "./model";

const MAP_W = 208;
const MAP_H = 136;
const PAD = 10;

type WorldBounds = {
  minX: number;
  minY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

type MinimapState = {
  rootEl: HTMLElement;
  canvasEl: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  bounds: WorldBounds | null;
  dragging: boolean;
  raf: number;
};

export class MinimapController {
  private states = new Map<CanvasLike, MinimapState>();
  private open: boolean;

  constructor(
    initialOpen: boolean,
    private onToggleChange: (open: boolean) => void
  ) {
    this.open = initialOpen;
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean, canvases: Iterable<CanvasLike>): void {
    this.open = open;
    this.onToggleChange(open);
    for (const canvas of canvases) {
      this.sync(canvas);
    }
  }

  toggle(canvases: Iterable<CanvasLike>): boolean {
    this.setOpen(!this.open, canvases);
    return this.open;
  }

  sync(canvas: CanvasLike): void {
    if (!this.open) {
      const st = this.states.get(canvas);
      if (st) st.rootEl.hidden = true;
      return;
    }
    const st = this.ensureState(canvas);
    if (!st) return;
    st.rootEl.hidden = false;
    this.scheduleDraw(canvas, st);
  }

  detach(canvas: CanvasLike): void {
    const st = this.states.get(canvas);
    if (!st) return;
    if (st.raf) cancelAnimationFrame(st.raf);
    st.rootEl.remove();
    this.states.delete(canvas);
  }

  destroy(): void {
    for (const canvas of Array.from(this.states.keys())) {
      this.detach(canvas);
    }
  }

  private ensureState(canvas: CanvasLike): MinimapState | null {
    const existing = this.states.get(canvas);
    if (existing && existing.rootEl.isConnected) return existing;
    existing?.rootEl.remove();

    const host = canvas.wrapperEl.closest(".view-content");
    if (!host) return null;

    const rootEl = host.createDiv({
      cls: "jce-minimap",
      attr: { "aria-label": "小地图 / Minimap" },
    });
    rootEl.hidden = !this.open;

    const closeBtn = rootEl.createEl("button", {
      type: "button",
      cls: "jce-minimap-close",
      attr: { title: "隐藏小地图 / Hide minimap", "aria-label": "Hide minimap" },
    });
    setIcon(closeBtn, "x");

    const canvasEl = rootEl.createEl("canvas", { cls: "jce-minimap-canvas" });
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvasEl.width = Math.round(MAP_W * dpr);
    canvasEl.height = Math.round(MAP_H * dpr);
    const ctx = canvasEl.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const state: MinimapState = {
      rootEl,
      canvasEl,
      ctx,
      bounds: null,
      dragging: false,
      raf: 0,
    };

    rootEl.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    closeBtn.addEventListener("pointerdown", (evt) => evt.stopPropagation());
    closeBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.open = false;
      this.onToggleChange(false);
      for (const st of this.states.values()) st.rootEl.hidden = true;
    });

    const panFromEvent = (evt: PointerEvent): void => {
      if (!state.bounds) return;
      const rect = canvasEl.getBoundingClientRect();
      const px = evt.clientX - rect.left;
      const py = evt.clientY - rect.top;
      const wx = state.bounds.minX + (px - state.bounds.offsetX) / state.bounds.scale;
      const wy = state.bounds.minY + (py - state.bounds.offsetY) / state.bounds.scale;
      panCanvasTo(canvas, wx, wy);
      this.draw(canvas, state);
    };

    canvasEl.addEventListener("pointerdown", (evt) => {
      if (evt.button !== 0) return;
      evt.preventDefault();
      evt.stopPropagation();
      state.dragging = true;
      canvasEl.setPointerCapture?.(evt.pointerId);
      panFromEvent(evt);
    });

    canvasEl.addEventListener("pointermove", (evt) => {
      if (!state.dragging) return;
      evt.preventDefault();
      panFromEvent(evt);
    });

    const endDrag = (evt: PointerEvent): void => {
      if (!state.dragging) return;
      state.dragging = false;
      try {
        canvasEl.releasePointerCapture?.(evt.pointerId);
      } catch {
        // ignore
      }
    };
    canvasEl.addEventListener("pointerup", endDrag);
    canvasEl.addEventListener("pointercancel", endDrag);

    this.states.set(canvas, state);
    return state;
  }

  private scheduleDraw(canvas: CanvasLike, state: MinimapState): void {
    if (state.raf) return;
    state.raf = window.requestAnimationFrame(() => {
      state.raf = 0;
      if (!this.open || !state.rootEl.isConnected) return;
      this.draw(canvas, state);
    });
  }

  private draw(canvas: CanvasLike, state: MinimapState): void {
    const ctx = state.ctx;
    if (!ctx) return;
    const isDark = document.body.classList.contains("theme-dark");

    ctx.clearRect(0, 0, MAP_W, MAP_H);

    const nodes = allNodes(canvas).filter(
      (n) => !n.nodeEl.classList.contains("jce-sec-hidden") && !n.nodeEl.classList.contains("jce-mm-hidden")
    );
    const vp = canvas.getViewportBBox();

    let minX = vp.minX;
    let minY = vp.minY;
    let maxX = vp.maxX;
    let maxY = vp.maxY;

    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }

    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxY - minY);
    const innerW = MAP_W - PAD * 2;
    const innerH = MAP_H - PAD * 2;
    const scale = Math.min(innerW / worldW, innerH / worldH);
    const offsetX = PAD + (innerW - worldW * scale) / 2;
    const offsetY = PAD + (innerH - worldH * scale) / 2;

    state.bounds = { minX, minY, scale, offsetX, offsetY };

    const toX = (wx: number) => offsetX + (wx - minX) * scale;
    const toY = (wy: number) => offsetY + (wy - minY) * scale;

    // 1. Draw groups/sections underneath cards.
    for (const n of nodes) {
      if (!isGroupNode(n)) continue;
      const x = toX(n.x);
      const y = toY(n.y);
      const w = Math.max(3, n.width * scale);
      const h = Math.max(3, n.height * scale);
      ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)";
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.18)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, h, 2);
      ctx.fill();
      ctx.stroke();
    }

    // 2. Draw cards / text / mindmap nodes.
    const selected = canvas.selection;
    for (const n of nodes) {
      if (isGroupNode(n)) continue;
      const x = toX(n.x);
      const y = toY(n.y);
      const w = Math.max(3, n.width * scale);
      const h = Math.max(2.5, n.height * scale);
      const bg = cardBgOf(n);
      if (bg) {
        ctx.fillStyle = bg;
      } else if (isMindmap(n)) {
        ctx.fillStyle = isDark ? "rgba(180, 195, 215, 0.45)" : "rgba(110, 125, 145, 0.35)";
      } else if (kindOf(n) === "note") {
        ctx.fillStyle = isDark ? "#35332d" : "#f7f1e3";
      } else {
        ctx.fillStyle = isDark ? "#3a3d42" : "#ffffff";
      }

      const isSel = selected?.has(n);
      ctx.strokeStyle = isSel
        ? "#4c8bf5"
        : isDark
          ? "rgba(255, 255, 255, 0.22)"
          : "rgba(0, 0, 0, 0.18)";
      ctx.lineWidth = isSel ? 1.25 : 0.75;
      roundRect(ctx, x, y, w, h, 1.5);
      ctx.fill();
      ctx.stroke();
    }

    // 3. Draw current viewport box.
    const vx = toX(vp.minX);
    const vy = toY(vp.minY);
    const vw = Math.max(8, (vp.maxX - vp.minX) * scale);
    const vh = Math.max(8, (vp.maxY - vp.minY) * scale);
    ctx.fillStyle = "rgba(76, 139, 245, 0.12)";
    ctx.strokeStyle = "rgba(76, 139, 245, 0.85)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, vx, vy, vw, vh, 2.5);
    ctx.fill();
    ctx.stroke();
  }
}

function panCanvasTo(canvas: CanvasLike, wx: number, wy: number): void {
  const z = typeof canvas.zoom === "number" && Number.isFinite(canvas.zoom)
    ? canvas.zoom
    : typeof canvas.tZoom === "number" && Number.isFinite(canvas.tZoom)
      ? canvas.tZoom
      : 0;
  if (typeof canvas.setViewport === "function") {
    canvas.setViewport(wx, wy, z);
  } else {
    canvas.tx = wx;
    canvas.ty = wy;
    canvas.markViewportChanged?.();
  }
  canvas.requestFrame();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
