/** Geometric icons, drawn for this plugin via SVG DOM (no innerHTML). */

const SVG_NS = "http://www.w3.org/2000/svg";

type SvgChild = {
  tag: "path" | "circle" | "rect";
  attrs: Record<string, string>;
};

const ICON_DEFS: Record<string, SvgChild[]> = {
  select: [
    {
      tag: "path",
      attrs: {
        d: "M5.5 3.8l6 16.2 2.3-6.1 6.1-2.3-14.4-7.8z",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linejoin": "round",
      },
    },
  ],
  connect: [
    {
      tag: "circle",
      attrs: { cx: "6.4", cy: "12", r: "2.1", fill: "none", stroke: "currentColor", "stroke-width": "1.6" },
    },
    {
      tag: "circle",
      attrs: { cx: "17.6", cy: "12", r: "2.1", fill: "none", stroke: "currentColor", "stroke-width": "1.6" },
    },
    {
      tag: "path",
      attrs: { d: "M8.5 12h7", fill: "none", stroke: "currentColor", "stroke-width": "1.6" },
    },
  ],
  note: [
    {
      tag: "rect",
      attrs: {
        x: "4.8",
        y: "4.5",
        width: "14.4",
        height: "15",
        rx: "2.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M8 9.2h8M8 12.4h8M8 15.6h4.6",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
      },
    },
  ],
  text: [
    {
      tag: "path",
      attrs: {
        d: "M6 7.2h12M12 7.2v10.6",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.7",
        "stroke-linecap": "round",
      },
    },
  ],
  mindmap: [
    {
      tag: "rect",
      attrs: {
        x: "8.4",
        y: "3.6",
        width: "7.2",
        height: "4",
        rx: "1.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
      },
    },
    {
      tag: "rect",
      attrs: {
        x: "3.4",
        y: "16.4",
        width: "6.4",
        height: "4",
        rx: "1.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
      },
    },
    {
      tag: "rect",
      attrs: {
        x: "14.2",
        y: "16.4",
        width: "6.4",
        height: "4",
        rx: "1.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M12 7.6v4.2M6.6 16.4v-2.2h10.8v2.2M12 11.8v2.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
      },
    },
  ],
  todo: [
    {
      tag: "path",
      attrs: {
        d: "M4.2 6.6l1.5 1.5 2.7-3",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    },
    {
      tag: "path",
      attrs: { d: "M11.2 6.4h8.6", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round" },
    },
    {
      tag: "path",
      attrs: {
        d: "M4.2 13.9l1.5 1.5 2.7-3",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    },
    {
      tag: "path",
      attrs: { d: "M11.2 13.7h8.6", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round" },
    },
    {
      tag: "path",
      attrs: {
        d: "M4.2 20.2h15.6",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
        opacity: ".45",
      },
    },
  ],
  section: [
    {
      tag: "rect",
      attrs: {
        x: "3.8",
        y: "5.6",
        width: "16.4",
        height: "12.8",
        rx: "2.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-dasharray": "3.2 2.6",
      },
    },
  ],
};

export function renderToolIcon(host: HTMLElement, id: string): void {
  const children = ICON_DEFS[id];
  if (!children) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "19");
  svg.setAttribute("height", "19");
  svg.setAttribute("aria-hidden", "true");
  for (const child of children) {
    const el = document.createElementNS(SVG_NS, child.tag);
    for (const [k, v] of Object.entries(child.attrs)) {
      el.setAttribute(k, v);
    }
    svg.appendChild(el);
  }
  host.appendChild(svg);
}
