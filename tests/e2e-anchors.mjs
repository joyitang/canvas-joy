/**
 * e2e-anchors.mjs — real CDP interaction & visual verification for free-sliding edge anchors.
 */

import path from "node:path";
import fs from "node:fs";
import { connect } from "./harness.mjs";

const SHOT_DIR =
  process.env.SHOT_DIR ||
  "/Users/joy/.gemini/antigravity/brain/6f0d0f9e-eccf-499f-bd1b-d105b76110e0/verify-anchors";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = await connect();
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

// Wait for canvas view & plugin to be ready, dismiss trust modal if shown
await h.evaluate(`(async () => {
  for (let i = 0; i < 40; i++) {
    const trustBtn = [...document.querySelectorAll("button")].find(b =>
      /Trust author|信任作者并启用插件|Turn on community plugins/i.test(b.textContent || "")
    );
    if (trustBtn) trustBtn.click();
    const leaf = app.workspace.getLeavesOfType("canvas")[0];
    if (leaf?.view?.canvas && app.plugins?.enabledPlugins?.has("canvas-joy")) {
      app.workspace.setActiveLeaf(leaf, { focus: true });
      const c = leaf.view.canvas;
      c.zoomToBbox({ minX: -430, minY: -40, maxX: 560, maxY: 690 });
      c.requestFrame();
      await new Promise(r => setTimeout(r, 400));
      return true;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error("Canvas or canvas-joy plugin did not initialize in time");
})()`);

// Helper: convert world (x, y) to viewport client (x, y)
async function worldToClient(wx, wy) {
  return h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const rect = c.wrapperEl.getBoundingClientRect();
    const scale = c.scale ?? Math.pow(2, c.zoom ?? 0);
    return {
      x: (${wx} - c.x) * scale + rect.left + rect.width / 2,
      y: (${wy} - c.y) * scale + rect.top + rect.height / 2,
    };
  })()`);
}

// Helper: drag native right connection dot of `fromNodeId` to world point `(wx, wy)`
async function nativeDragConnect(fromNodeId, targetWx, targetWy) {
  // Hover the source card so Obsidian attaches the interaction layer + connection dot
  const srcCenter = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const n = c.nodes.get(${JSON.stringify(fromNodeId)});
    const r = n.nodeEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await h.mouse("mouseMoved", srcCenter.x, srcCenter.y, { buttons: 0 });
  await sleep(180);

  const dotPos = await h.evaluate(`(() => {
    const dot = document.querySelector('.canvas-node-connection-point[data-side="right"]');
    if (!dot) return null;
    const r = dot.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!dotPos) throw new Error("Native right connection dot not found for " + fromNodeId);

  const dst = await worldToClient(targetWx, targetWy);
  await h.drag(dotPos.x, dotPos.y, dst.x, dst.y, 16);
  await sleep(280);
}

// AC-01: Native drag-to-connect from two stacked cards onto different timeline lines of the tall card
await record("AC-01", "原生小圆点拖出两条连线分别落在大卡不同时间线位置", async () => {
  await h.key("Escape");
  await sleep(100);
  await h.evaluate(`(async () => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    for (const e of [...c.edges.values()]) c.removeEdge(e);
    c.deselectAll();
    c.zoomToBbox({ minX: -430, minY: -40, maxX: 560, maxY: 690 });
    c.requestFrame();
    await new Promise(r => setTimeout(r, 200));
  })()`);

  // Connect top-left card to y=360 on left border of right card (near "5-7世纪的争议")
  await nativeDragConnect("n-top", 84, 360);
  // Connect bottom-left card to y=515 on left border of right card (near "1054年...基督教分裂")
  await nativeDragConnect("n-bot", 84, 515);

  const edges = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    return [...c.edges.values()].map(e => ({
      id: e.id,
      from: e.from.node.id,
      to: e.to.node.id,
      toSide: e.to.side,
      toOffset: e.unknownData?.jceToOffset ?? null,
      arrowTransform: e.toLineEnd?.el?.style?.transform ?? "",
    }));
  })()`);

  await h.shot(path.join(SHOT_DIR, "01-native-drag-two-lines.png"));

  const eTop = edges.find((e) => e.from === "n-top" && e.to === "n-right");
  const eBot = edges.find((e) => e.from === "n-bot" && e.to === "n-right");
  const ok =
    !!eTop &&
    !!eBot &&
    eTop.toSide === "left" &&
    eBot.toSide === "left" &&
    typeof eTop.toOffset === "number" &&
    typeof eBot.toOffset === "number" &&
    Math.abs(eTop.toOffset - 360) <= 25 &&
    Math.abs(eBot.toOffset - 515) <= 25 &&
    eBot.toOffset - eTop.toOffset >= 120;

  return {
    ok,
    detail: `top=(side:${eTop?.toSide}, off:${eTop?.toOffset}) bot=(side:${eBot?.toSide}, off:${eBot?.toOffset})`,
  };
});

// AC-02: Select edge -> endpoint handle appears -> drag handle smoothly along tall card edge
await record("AC-02", "选中连线显示锚点手柄并自由沿边拖动定位", async () => {
  await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const e = [...c.edges.values()].find(x => x.from.node.id === "n-bot");
    c.selectOnly(e);
    c.requestFrame();
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  })()`);
  await sleep(220);

  const handleBefore = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const e = [...c.edges.values()].find(x => x.from.node.id === "n-bot");
    const hEl = c.canvasEl.querySelector('.jce-edge-handle[data-end="to"]');
    const r = hEl.getBoundingClientRect();
    const style = getComputedStyle(hEl);
    return {
      visible: !hEl.hidden && style.display !== "none",
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      offset: e.unknownData?.jceToOffset ?? null,
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "02-selected-edge-handles.png"));

  // Drag the `to` handle upward to y=470 on the right card's left border
  const target = await worldToClient(82, 470);
  await h.drag(handleBefore.cx, handleBefore.cy, target.x, target.y, 14);
  await sleep(250);

  const after = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const e = [...c.edges.values()].find(x => x.from.node.id === "n-bot");
    return {
      toSide: e.to.side,
      toOffset: e.unknownData?.jceToOffset ?? null,
      arrowTransform: e.toLineEnd?.el?.style?.transform ?? "",
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "03-after-handle-drag.png"));

  const ok =
    handleBefore.visible &&
    after.toSide === "left" &&
    typeof after.toOffset === "number" &&
    Math.abs(after.toOffset - 470) <= 20;

  return {
    ok,
    detail: `visible=${handleBefore.visible}, beforeOff=${handleBefore.offset}, afterOff=${after.toOffset}, side=${after.toSide}`,
  };
});

// AC-03: Grow tall card downward -> existing pixel offsets stay locked (no drift!)
await record("AC-03", "拉长右边时间线大卡底部，箭头保持原高度不漂移", async () => {
  const beforeY = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const e = [...c.edges.values()].find(x => x.from.node.id === "n-top");
    return e.toLineEnd?.el?.style?.transform ?? "";
  })()`);

  await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const n = c.nodes.get("n-right");
    n.resize({ width: n.width, height: 920 });
    c.requestSave();
    c.requestFrame();
  })()`);
  await sleep(250);

  const afterY = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const e = [...c.edges.values()].find(x => x.from.node.id === "n-top");
    return e.toLineEnd?.el?.style?.transform ?? "";
  })()`);

  return {
    ok: beforeY === afterY && beforeY.length > 0,
    detail: `before=${beforeY} after=${afterY}`,
  };
});

// AC-04: Save to disk + re-import from saved .canvas JSON -> offsets persist cleanly
await record("AC-04", "持久化写入 .canvas 并重开恢复原位置", async () => {
  // Restore card height to 640 and save
  const persisted = await h.evaluate(`(async () => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const n = c.nodes.get("n-right");
    n.resize({ width: 440, height: 640 });
    c.deselectAll();
    const raw = JSON.parse(JSON.stringify(c.getData()));
    // Simulate closing and reopening by clearing & importing raw data
    c.importData({ nodes: [], edges: [] }, true);
    await new Promise(r => setTimeout(r, 120));
    c.importData(raw, true);
    c.requestFrame();
    await new Promise(r => setTimeout(r, 250));
    return {
      rawEdges: raw.edges.map(e => ({ from: e.fromNode, toOffset: e.jceToOffset })),
      restored: [...c.edges.values()].map(e => ({
        from: e.from.node.id,
        toOffset: e.unknownData?.jceToOffset ?? null,
        arrow: e.toLineEnd?.el?.style?.transform ?? "",
      })),
    };
  })()`);

  await h.shot(path.join(SHOT_DIR, "04-after-reload-persisted.png"));

  const ok =
    persisted.rawEdges.length === 2 &&
    persisted.rawEdges.every((e) => typeof e.toOffset === "number") &&
    persisted.restored.every((e) => typeof e.toOffset === "number" && e.arrow.includes("translate("));

  return {
    ok,
    detail: JSON.stringify(persisted.restored),
  };
});

// AC-05: C connect tool auto-aligns horizontally onto tall card
await record("AC-05", "C 连线工具自动平齐连接（不挤中点）", async () => {
  await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    for (const e of [...c.edges.values()]) c.removeEdge(e);
    c.requestFrame();
  })()`);
  await sleep(180);

  // Press 'c' to enter connect tool, click top-left card then right card
  await h.key("c");
  await sleep(120);
  const pTop = await worldToClient(-200, 200);
  const pRight = await worldToClient(300, 300);
  await h.click(pTop.x, pTop.y);
  await sleep(120);
  await h.click(pRight.x, pRight.y);
  await sleep(220);

  // Click bottom-left card then right card
  const pBot = await worldToClient(-200, 505);
  await h.click(pBot.x, pBot.y);
  await sleep(120);
  await h.click(pRight.x, pRight.y);
  await sleep(250);
  await h.key("Escape");
  await sleep(150);

  const edges = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    return [...c.edges.values()].map(e => ({
      from: e.from.node.id,
      toOffset: e.unknownData?.jceToOffset ?? null,
      arrow: e.toLineEnd?.el?.style?.transform ?? "",
    }));
  })()`);
  await h.shot(path.join(SHOT_DIR, "05-connect-tool-auto-aligned.png"));

  const eTop = edges.find((e) => e.from === "n-top");
  const eBot = edges.find((e) => e.from === "n-bot");
  // n-top centerY = 90 + 110 = 200; n-bot centerY = 420 + 85 = 505
  const ok =
    eTop?.toOffset === 200 &&
    eBot?.toOffset === 505;

  return {
    ok,
    detail: `top=${eTop?.toOffset} (expect 200), bot=${eBot?.toOffset} (expect 505)`,
  };
});

console.log("\nConsole errors:", h.consoleErrors.length ? h.consoleErrors : "none");
const failed = results.filter((r) => !r.ok);
h.close();
process.exit(failed.length ? 1 : 0);
