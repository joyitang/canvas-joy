/**
 * overlay.ts — mindmap hierarchy lines.
 *
 * A single SVG lives inside the canvas world layer (`canvas.canvasEl`), which
 * already carries the pan/zoom transform. Because the overlay is a child of
 * that layer, coordinates are plain canvas coordinates: panning and zooming
 * need no per-frame maths, and lines cannot drift away from their nodes.
 */

import { CanvasLike } from "./bridge";
import { connector } from "./layout";
import { hiddenByFold, rootIds, treeOf } from "./model";

const NS = "http://www.w3.org/2000/svg";
const OVERLAY_CLASS = "jce-overlay";

export function overlayFor(canvas: CanvasLike): SVGSVGElement {
  const layer = canvas.canvasEl;
  let svg = layer.querySelector<SVGSVGElement>(`svg.${OVERLAY_CLASS}`);
  if (!svg) {
    svg = document.createElementNS(NS, "svg");
    svg.classList.add(OVERLAY_CLASS);
    // First child: hierarchy lines paint behind both native edges and nodes.
    layer.prepend(svg);
  }
  return svg;
}

export type Segment = { d: string; arrow: string };

/** Geometry for every visible mindmap relation, in canvas coordinates. */
export function segmentsFor(canvas: CanvasLike): Segment[] {
  const hidden = hiddenByFold(canvas);
  const out: Segment[] = [];
  for (const root of rootIds(canvas)) {
    const tree = treeOf(canvas, root);
    const walk = (id: string) => {
      if (hidden.has(id)) return;
      const parent = canvas.nodes.get(id);
      if (!parent) return;
      for (const childId of tree.children.get(id) ?? []) {
        if (hidden.has(childId)) continue;
        const child = canvas.nodes.get(childId);
        if (!child) continue;
        out.push(connector(parent, child, tree.layout));
        walk(childId);
      }
    };
    walk(root);
  }
  return out;
}

export function drawOverlay(canvas: CanvasLike): void {
  const svg = overlayFor(canvas);
  const segments = segmentsFor(canvas);

  if (!segments.length) {
    svg.replaceChildren();
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    styleOverlay(svg, 0, 0, 0, 0);
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of segments) {
    for (const pt of pointsOf(seg)) {
      minX = Math.min(minX, pt[0]);
      minY = Math.min(minY, pt[1]);
      maxX = Math.max(maxX, pt[0]);
      maxY = Math.max(maxY, pt[1]);
    }
  }
  const pad = 8;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  svg.setAttribute("viewBox", `${minX} ${minY} ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  styleOverlay(svg, minX, minY, w, h);

  const frag = document.createDocumentFragment();
  for (const seg of segments) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", seg.d);
    path.setAttribute("class", "jce-mm-path");
    frag.appendChild(path);
    const head = document.createElementNS(NS, "polygon");
    head.setAttribute("points", seg.arrow);
    head.setAttribute("class", "jce-mm-arrow");
    frag.appendChild(head);
  }
  svg.replaceChildren(frag);
}

function styleOverlay(svg: SVGSVGElement, left: number, top: number, w: number, h: number): void {
  svg.setCssProps({
    "--jce-ov-left": `${left}px`,
    "--jce-ov-top": `${top}px`,
    "--jce-ov-w": `${w}px`,
    "--jce-ov-h": `${h}px`,
  });
}

/** Sample coordinates from a segment so we can size the viewBox. */
function pointsOf(seg: Segment): [number, number][] {
  const nums = seg.d.match(/-?\d+(\.\d+)?/g) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push([Number(nums[i]), Number(nums[i + 1])]);
  }
  const poly = seg.arrow.match(/-?\d+(\.\d+)?/g) ?? [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    out.push([Number(poly[i]), Number(poly[i + 1])]);
  }
  return out;
}

export function clearOverlay(canvas: CanvasLike): void {
  canvas.canvasEl.querySelector(`svg.${OVERLAY_CLASS}`)?.remove();
}
