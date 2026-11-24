/**
 * e2e-v15.mjs — real CDP interaction + screenshot verification for v1.5.0:
 *   1. Multi-select alignment bar (align top, distribute horizontally, ⌘Z undo)
 *   2. Whiteboard minimap (hidden by default, toolbar toggle, click-to-pan, drag-to-pan, close)
 */

import path from "node:path";
import fs from "node:fs";
import { connect } from "./harness.mjs";

const SHOT_DIR =
  process.env.SHOT_DIR ||
  "/Users/joy/.gemini/antigravity/brain/574cd2ac-3539-4206-acef-fb4256122813/verify-v15";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const h = await connect();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function record(id, name, fn) {
  try {
    const out = await fn();
    results.push({ id, name, ok: !!out.ok, detail: out.detail });
    console.log(`${out.ok ? "PASS" : "FAIL"} [${id}] ${name} — ${out.detail}`);
  } catch (err) {
    results.push({ id, name, ok: false, detail: String(err?.message || err) });
    console.log(`FAIL [${id}] ${name} — ${err?.message || err}`);
  }
}

async function seedCanvas(data) {
  await h.evaluate(`(async () => {
    const leaf = app.workspace.getLeavesOfType("canvas")[0];
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const c = leaf.view.canvas;
    c.importData(${JSON.stringify(data)}, true);
    c.zoomToBbox({ minX: -500, minY: -260, maxX: 900, maxY: 360 });
    c.requestFrame();
    await new Promise(r => setTimeout(r, 380));
  })()`);
}

function makeFixture() {
  return {
    nodes: [
      { id: "a", type: "text", text: "# 卡片 A\n第一张错落卡片", x: -420, y: -180, width: 220, height: 140, jce: "note", jceBg: "#fdf6d8" },
      { id: "b", type: "text", text: "# 卡片 B\n第二张错落卡片", x: -120, y: -40, width: 220, height: 140, jce: "note", jceBg: "#eaf2fd" },
      { id: "c", type: "text", text: "# 卡片 C\n第三张错落卡片", x: 340, y: -120, width: 220, height: 140, jce: "note", jceBg: "#e9f6ec" },
      { id: "far", type: "text", text: "# 远处卡片\n用于测试小地图跳转", x: 1600, y: 800, width: 280, height: 180, jce: "note", jceBg: "#fdeef2" },
    ],
    edges: [],
  };
}

// 1. Multi-select align top + distribute horizontally + Cmd+Z undo
await record("V15-01", "多选对齐条（顶对齐 + 水平等距 + ⌘Z 撤销）", async () => {
  await seedCanvas(makeFixture());
  await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.pushHistory?.(c.getData());
    c.deselectAll();
    c.select(c.nodes.get("a"));
    c.select(c.nodes.get("b"));
    c.select(c.nodes.get("c"));
    c.requestFrame();
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  })()`);
  await sleep(300);

  const barVisible = await h.evaluate(`(() => {
    const bar = document.querySelector(".jce-align-bar");
    return !!bar && !bar.hidden;
  })()`);
  await h.shot(path.join(SHOT_DIR, "01-align-bar.png"));

  // Click align top
  const topBtn = await h.evaluate(`(() => {
    const b = document.querySelector('.jce-align-btn[data-align="top"]');
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
  await h.click(topBtn.cx, topBtn.cy);
  await sleep(220);

  const afterTop = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    return ["a", "b", "c"].map(id => ({ id, x: Math.round(c.nodes.get(id).x), y: Math.round(c.nodes.get(id).y) }));
  })()`);

  // Click distribute horizontally
  const distBtn = await h.evaluate(`(() => {
    const b = document.querySelector('.jce-align-btn[data-align="distX"]');
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
  await h.click(distBtn.cx, distBtn.cy);
  await sleep(220);

  const afterDist = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    return ["a", "b", "c"].map(id => ({ id, x: Math.round(c.nodes.get(id).x), y: Math.round(c.nodes.get(id).y) }));
  })()`);
  await h.shot(path.join(SHOT_DIR, "02-aligned.png"));

  // Trigger Obsidian's Canvas Undo to verify pre-distX x of "b" is restored
  await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.undo?.();
    c.requestFrame();
  })()`);
  await sleep(240);
  const afterUndo = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    return Math.round(c.nodes.get("b").x);
  })()`);

  const topAligned = afterTop.every((n) => n.y === -180);
  const gap1 = afterDist[1].x - (afterDist[0].x + 220);
  const gap2 = afterDist[2].x - (afterDist[1].x + 220);
  const distEven = Math.abs(gap1 - gap2) <= 2;
  const undoOk = afterUndo === -120;

  return {
    ok: barVisible && topAligned && distEven && undoOk,
    detail: `bar=${barVisible}, top=${JSON.stringify(afterTop)}, gaps=(${gap1},${gap2}), undoBx=${afterUndo}`,
  };
});

// 2. Minimap default hidden -> toggle on -> click to pan -> toggle off
await record("V15-02", "小地图（默认隐藏 + 工具栏开关 + 点击跳转定位）", async () => {
  await seedCanvas(makeFixture());
  const initiallyHidden = await h.evaluate(`(() => {
    const el = document.querySelector(".jce-minimap");
    return !el || el.hidden;
  })()`);

  const toggleBtn = await h.evaluate(`(() => {
    const b = document.querySelector('.jce-toolbar .jce-tool[data-tool="minimap"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
  if (!toggleBtn) return { ok: false, detail: "minimap toolbar button not found" };

  await h.click(toggleBtn.cx, toggleBtn.cy);
  await sleep(280);

  const shown = await h.evaluate(`(() => {
    const el = document.querySelector(".jce-minimap");
    const r = el?.getBoundingClientRect();
    return { visible: !!el && !el.hidden, w: Math.round(r?.width || 0), h: Math.round(r?.height || 0) };
  })()`);
  await h.shot(path.join(SHOT_DIR, "03-minimap-open.png"));

  // Click bottom-right area of minimap where "far" card (1600, 800) lives
  const beforeVp = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const vp = c.getViewportBBox();
    return { cx: Math.round((vp.minX + vp.maxX) / 2), cy: Math.round((vp.minY + vp.maxY) / 2) };
  })()`);
  const targetPt = await h.evaluate(`(() => {
    const el = document.querySelector(".jce-minimap-canvas");
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width * 0.85, y: r.y + r.height * 0.85 };
  })()`);
  await h.click(targetPt.x, targetPt.y);
  await sleep(260);

  const afterVp = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const vp = c.getViewportBBox();
    return { cx: Math.round((vp.minX + vp.maxX) / 2), cy: Math.round((vp.minY + vp.maxY) / 2) };
  })()`);

  // Toggle off
  await h.click(toggleBtn.cx, toggleBtn.cy);
  await sleep(180);
  const hiddenAgain = await h.evaluate(`(() => {
    const el = document.querySelector(".jce-minimap");
    return !el || el.hidden;
  })()`);

  const panned = afterVp.cx > beforeVp.cx + 400 && afterVp.cy > beforeVp.cy + 200;
  return {
    ok: initiallyHidden && shown.visible && panned && hiddenAgain,
    detail: `initHidden=${initiallyHidden}, shown=${JSON.stringify(shown)}, vp=${JSON.stringify(beforeVp)}->${JSON.stringify(afterVp)}, hiddenAgain=${hiddenAgain}`,
  };
});

console.log("\nConsole errors:", h.consoleErrors);
const failed = results.filter((r) => !r.ok);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
h.close();
process.exit(failed.length ? 1 : 0);
