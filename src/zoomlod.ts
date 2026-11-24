/**
 * zoomlod.ts — zoom-out semantic card readability (Zoom-out LOD).
 *
 * Obsidian unmounts `.canvas-node-content` below `zoomBreakpoint` (~0.308) and
 * shows a blank align-left icon for text cards. Normal zoom levels (> 0.32)
 * keep Obsidian's native markdown, images, and formatting completely untouched;
 * only when zoomed far out (`mod-zoomed-out` or scale <= 0.32) does this module
 * render a readable counter-scaled title/badge overlay and enlarged section labels.
 */

import { CanvasLike, allNodes, isEditing, scaleOf } from "./bridge";
import {
  isCardFolded,
  isGroupNode,
  isMindmap,
  nodeTextContent,
  nodeTitleOf,
  todoProgressOf,
} from "./model";

export const FAR_SCALE = 0.32;

export class ZoomLodController {
  private lastScale = new WeakMap<CanvasLike, number>();

  sync(canvas: CanvasLike): void {
    const scale = scaleOf(canvas);
    const prev = this.lastScale.get(canvas);
    if (prev === undefined || Math.abs(scale - prev) > 0.004) {
      this.lastScale.set(canvas, scale);
      canvas.wrapperEl.setCssProps({ "--jce-scale": scale.toFixed(3) });
    }

    const nativeZoomOut = canvas.wrapperEl.classList.contains("mod-zoomed-out");
    const isFar = nativeZoomOut || scale <= FAR_SCALE;

    canvas.wrapperEl.toggleClass("jce-zoom-far", isFar);

    for (const node of allNodes(canvas)) {
      const host = node.containerEl;
      if (!host) continue;
      let overlay = host.querySelector<HTMLElement>(":scope > .jce-lod-overlay");

      const skip =
        !isFar ||
        isMindmap(node) ||
        isGroupNode(node) ||
        isCardFolded(node) ||
        isEditing(node) ||
        node.nodeEl.classList.contains("jce-sec-hidden");

      if (skip) {
        if (overlay) overlay.hidden = true;
        continue;
      }

      const title = nodeTitleOf(node);
      const todo = todoProgressOf(nodeTextContent(node));
      const badge = todo ? `✓ ${todo.done}/${todo.total}` : "";
      const compact = node.height < 115;
      const sig = `${title}\n${badge}\n${compact ? "C" : ""}`;

      if (!overlay) {
        overlay = host.createDiv({ cls: "jce-lod-overlay" });
        overlay.createDiv({ cls: "jce-lod-title" });
        overlay.createDiv({ cls: "jce-lod-badge" });
      }

      overlay.hidden = false;
      overlay.toggleClass("is-compact", compact);
      if (overlay.dataset.sig !== sig) {
        overlay.dataset.sig = sig;
        const titleEl = overlay.querySelector<HTMLElement>(".jce-lod-title");
        const badgeEl = overlay.querySelector<HTMLElement>(".jce-lod-badge");
        if (titleEl) titleEl.textContent = title;
        if (badgeEl) {
          badgeEl.textContent = badge;
          badgeEl.hidden = !badge;
        }
      }
    }
  }

  detach(canvas: CanvasLike): void {
    this.lastScale.delete(canvas);
    canvas.wrapperEl.classList.remove("jce-zoom-far");
    canvas.wrapperEl.style.removeProperty("--jce-scale");
    for (const node of allNodes(canvas)) {
      node.nodeEl.querySelector(".jce-lod-overlay")?.remove();
    }
  }
}
