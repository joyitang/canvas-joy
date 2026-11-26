import fs from "node:fs";
import { connect } from "./harness.mjs";

const OUT_DIR = "/Users/joy/.gemini/antigravity/brain/1e59bac3-3e49-429c-8012-53d33282a9d5/scratch";
const h = await connect();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓", msg);
};

async function shot(name) {
  const res = await h.send("Page.captureScreenshot", { format: "png" });
  const p = `${OUT_DIR}/${name}.png`;
  fs.writeFileSync(p, Buffer.from(res.data, "base64"));
  console.log("  📸", p);
}

// 1. Ensure canvas open
await h.call(async () => {
  const f = app.vault.getAbstractFileByPath("medieval-notes.canvas");
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(f);
  app.workspace.setActiveLeaf(leaf, { focus: true });
});
await sleep(500);

console.log("1. Default closed state: zero outline UI on canvas until toolbar clicked");
const init = await h.call(() => {
  const drawer = document.querySelector(".jce-outline-drawer.is-open");
  const btn = document.querySelector('.jce-toolbar .jce-tool[data-tool="outline"]');
  const r = btn?.getBoundingClientRect();
  return {
    hasOpenDrawer: !!drawer,
    hasBtn: !!btn,
    btnCenter: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null,
  };
});
if (init.hasOpenDrawer) {
  await h.click(init.btnCenter.x, init.btnCenter.y);
  await sleep(300);
}

// 2. Click toolbar button -> opens expanded at (66, 14), width 244, no sort bar, tight height
console.log("2. Open expanded drawer (no sort bar, tight height, 244px width)");
await h.click(init.btnCenter.x, init.btnCenter.y);
await sleep(320);

const opened = await h.call(() => {
  const d = document.querySelector(".jce-outline-drawer");
  const host = d?.parentElement?.getBoundingClientRect();
  const dr = d?.getBoundingClientRect();
  return {
    open: !!d?.classList.contains("is-open"),
    relX: dr && host ? Math.round(dr.left - host.left) : null,
    relY: dr && host ? Math.round(dr.top - host.top) : null,
    width: dr ? Math.round(dr.width) : null,
    height: dr ? Math.round(dr.height) : null,
    hasSortBar: !!document.querySelector(".jce-outline-sort-bar"),
    count: document.querySelectorAll(".jce-outline-item").length,
  };
});
assert(opened.open && opened.width === 244, `Expanded width 244px (got ${opened.width}x${opened.height})`);
assert(!opened.hasSortBar, "Sort bar is completely removed");
await shot("outline-v4-expanded");

// 3. Click item -> jumps & selects
console.log("3. Click item jumps to Section");
await h.call(() => {
  const rows = [...document.querySelectorAll(".jce-outline-item")];
  rows.find((r) => r.textContent?.includes("第四章"))?.click();
});
await sleep(250);
const selLabel = await h.call(() => [...app.workspace.activeLeaf.view.canvas.selection][0]?.getData?.()?.label);
assert(selLabel?.includes("第四章"), `Jumped & selected 第四章 (got ${selLabel})`);

// 4. Drag-to-reorder inside list
console.log("4. Drag-to-reorder inside list");
const firstBefore = await h.call(() => document.querySelector(".jce-outline-item-label")?.textContent?.trim());
await h.call(() => {
  const rows = [...document.querySelectorAll(".jce-outline-item")];
  const dragRow = rows[0];
  const targetRow = rows[rows.length - 1];
  const r = targetRow.getBoundingClientRect();
  const dt = new DataTransfer();
  dt.setData("text/plain", dragRow.dataset.sectionId);
  dragRow.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
  targetRow.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, clientY: r.bottom - 2, bubbles: true, cancelable: true }));
  targetRow.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientY: r.bottom - 2, bubbles: true, cancelable: true }));
  dragRow.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
});
await sleep(250);
const lastAfter = await h.call(() => {
  const labels = [...document.querySelectorAll(".jce-outline-item-label")].map((e) => e.textContent?.trim());
  return labels[labels.length - 1];
});
assert(lastAfter === firstBefore, `Dragged '${firstBefore}' to bottom (got '${lastAfter}')`);

// 5. Compact capsule mode -> 172px smooth morph
console.log("5. Compact capsule mode (172x~38)");
await h.call(() => document.querySelector(".jce-outline-compact-btn")?.click());
await sleep(320);
const cap = await h.call(() => {
  const r = document.querySelector(".jce-outline-drawer").getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height) };
});
assert(cap.width === 172 && cap.height <= 42, `Capsule smoothly morphed to 172x~38 (got ${cap.width}x${cap.height})`);
await shot("outline-v4-capsule");

// Expand back for Joy's live inspection
await h.call(() => document.querySelector(".jce-outline-compact-btn")?.click());
await sleep(320);

assert(h.consoleErrors.length === 0, `Zero console errors (got ${h.consoleErrors.length})`);
console.log("ALL V4 OUTLINE E2E TESTS PASSED!");
process.exit(0);
