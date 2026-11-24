/**
 * e2e-v14.mjs — real CDP interaction + screenshot verification for v1.4.0:
 *   1. In-canvas search (toolbar button / ⌘F, count, dropdown, jump, Esc)
 *   2. Focus Mode (single card excludes connected neighbors; section includes children; blank click exits)
 *   3. Group selection into section (⌘G wraps selected cards)
 *   4. Heptabase-style card & section collapse (top-level card, child card in section, section itself, drag-while-folded, reopen persistence)
 *   5. Zoom-out semantic readability (mid ~42% and far ~22% LOD + section titles)
 */

import path from "node:path";
import fs from "node:fs";
import { connect } from "./harness.mjs";

const SHOT_DIR =
  process.env.SHOT_DIR ||
  "/Users/joy/.gemini/antigravity/brain/574cd2ac-3539-4206-acef-fb4256122813/verify";
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
    const allLeaves = app.workspace.getLeavesOfType("canvas");
    for (let i = 1; i < allLeaves.length; i++) allLeaves[i].detach();
    for (const g of app.workspace.getLeavesOfType("graph")) g.detach();
    let leaf = app.workspace.getLeavesOfType("canvas")[0];
    if (!leaf) {
      const f = app.vault.getAbstractFileByPath("test.canvas");
      leaf = app.workspace.getLeaf(false);
      await leaf.openFile(f);
      await new Promise(r => setTimeout(r, 350));
    }
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const c = leaf?.view?.canvas;
    if (!c) throw new Error("no canvas");
    c.importData(${JSON.stringify(data)}, true);
    c.zoomToBbox({ minX: -420, minY: -220, maxX: 760, maxY: 280 });
    c.requestFrame();
    c.requestSave();
    await new Promise(r => setTimeout(r, 420));
  })()`);
}

function makeFixture() {
  return {
    nodes: [
      {
        id: "n-growth",
        type: "text",
        text: "# 增长实验复盘\n小红书投放 ROI 提升 32%，核心抓手是首图对比与场景化标题。\n- [x] 整理上周数据\n- [ ] 输出新素材 brief",
        x: -360,
        y: -140,
        width: 290,
        height: 210,
        jce: "note",
        jceBg: "#fdf6d8",
      },
      {
        id: "n-neighbor",
        type: "text",
        text: "# 关联渠道笔记\n自然搜索与付费投放的归因口径对齐，避免重复统计转化。",
        x: 20,
        y: -140,
        width: 280,
        height: 190,
        jce: "note",
        jceBg: "#eaf2fd",
      },
      {
        id: "n-text",
        type: "text",
        text: "投放预算上限：本月控制在 5 万以内，周度复盘调整",
        x: -360,
        y: 110,
        width: 280,
        height: 90,
        jce: "text",
      },
      {
        id: "sec-1",
        type: "group",
        label: "Q4 内容规划分区",
        x: 360,
        y: -180,
        width: 340,
        height: 410,
        jce: "section",
      },
      {
        id: "n-child-1",
        type: "text",
        text: "# 徒步路线合集\n整理江浙沪秋季 10 条轻徒步路线，突出新手友好与交通方式。",
        x: 390,
        y: -120,
        width: 280,
        height: 150,
        jce: "note",
        jceBg: "#e9f6ec",
      },
      {
        id: "n-child-2",
        type: "text",
        text: "# 增长专题待办\n- [x] 确认主视觉\n- [ ] 预约达人档期\n- [ ] 上线落地页",
        x: 390,
        y: 55,
        width: 280,
        height: 150,
        jce: "note",
        jceBg: "#fdeef2",
      },
    ],
    edges: [
      {
        id: "e-1",
        fromNode: "n-growth",
        fromSide: "right",
        toNode: "n-neighbor",
        toSide: "left",
      },
    ],
  };
}

// 1. In-canvas search
await record("V14-01", "画布内搜索（工具栏放大镜 + 下拉 + 居中高亮 + Esc）", async () => {
  await seedCanvas(makeFixture());
  const btnRect = await h.evaluate(`(() => {
    const b = document.querySelector('.jce-toolbar .jce-tool[data-tool="search"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
  if (!btnRect) return { ok: false, detail: "search toolbar button not found" };

  await h.click(btnRect.cx, btnRect.cy);
  await sleep(180);
  await h.evaluate(`(() => {
    const inp = document.querySelector('.jce-search-input');
    inp.value = '增长';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);

  const state = await h.evaluate(`(() => {
    const bar = document.querySelector('.jce-search-bar');
    const count = document.querySelector('.jce-search-count')?.textContent;
    const items = document.querySelectorAll('.jce-search-item').length;
    const hits = document.querySelectorAll('.canvas-node.jce-search-hit').length;
    const cur = document.querySelectorAll('.canvas-node.jce-search-current').length;
    return { visible: !!bar && !bar.hidden, count, items, hits, cur };
  })()`);
  await h.shot(path.join(SHOT_DIR, "01-search.png"));

  // Press Enter to step to 2nd match, then Escape to close
  await h.key("Enter");
  await sleep(220);
  const countAfterEnter = await h.evaluate(`document.querySelector('.jce-search-count')?.textContent`);
  await h.key("Escape");
  await sleep(180);
  const closed = await h.evaluate(`(() => {
    const bar = document.querySelector('.jce-search-bar');
    const hits = document.querySelectorAll('.canvas-node.jce-search-hit').length;
    return { hidden: !!bar?.hidden, hits };
  })()`);

  const ok =
    state.visible &&
    state.count === "1/2" &&
    state.items === 2 &&
    state.hits >= 1 &&
    state.cur === 1 &&
    countAfterEnter === "2/2" &&
    closed.hidden &&
    closed.hits === 0;
  return {
    ok,
    detail: `state=${JSON.stringify(state)}, afterEnter=${countAfterEnter}, closed=${JSON.stringify(closed)}`,
  };
});

// 2. Focus Mode — single card (strict: NO neighbor highlighting)
await record("V14-02", "聚焦模式：单卡仅高亮自身（不含连线邻接卡）", async () => {
  await seedCanvas(makeFixture());
  await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.selectOnly(c.nodes.get("n-growth"));
    c.wrapperEl.focus();
  })()`);
  await sleep(150);
  await h.key("f");
  await sleep(260);

  const st = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const op = (id) => getComputedStyle(c.nodes.get(id).nodeEl).opacity;
    const edge = c.edges.get("e-1");
    const edgeOp = edge?.lineGroupEl ? getComputedStyle(edge.lineGroupEl).opacity : null;
    const pill = !!document.querySelector(".jce-focus-pill");
    return {
      growth: op("n-growth"),
      neighbor: op("n-neighbor"),
      text: op("n-text"),
      edgeOp,
      pill,
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "02-focus-card.png"));

  const ok =
    st.pill &&
    Number(st.growth) > 0.95 &&
    Number(st.neighbor) < 0.25 &&
    Number(st.text) < 0.25 &&
    Number(st.edgeOp) < 0.25;
  return { ok, detail: JSON.stringify(st) };
});

// 3. Focus Mode — section includes inner children + blank click exits
await record("V14-03", "聚焦模式：分区含内部子卡 + 点击空白退出", async () => {
  await h.key("Escape");
  await sleep(160);
  await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.selectOnly(c.nodes.get("sec-1"));
    c.wrapperEl.focus();
  })()`);
  await sleep(150);
  await h.key("f");
  await sleep(260);

  const st = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const op = (id) => getComputedStyle(c.nodes.get(id).nodeEl).opacity;
    return {
      sec: op("sec-1"),
      child1: op("n-child-1"),
      child2: op("n-child-2"),
      outside: op("n-growth"),
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "03-focus-section.png"));

  // Click blank space near bottom-left of canvas
  const blank = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const r = c.wrapperEl.getBoundingClientRect();
    return { x: r.x + r.width * 0.18, y: r.y + r.height * 0.85 };
  })()`);
  await h.click(blank.x, blank.y);
  await sleep(240);

  const exited = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    return {
      focusClass: c.wrapperEl.classList.contains("jce-focus-mode"),
      outsideOp: getComputedStyle(c.nodes.get("n-growth").nodeEl).opacity,
      pill: !!document.querySelector(".jce-focus-pill"),
    };
  })()`);

  const ok =
    Number(st.sec) > 0.95 &&
    Number(st.child1) > 0.95 &&
    Number(st.child2) > 0.95 &&
    Number(st.outside) < 0.25 &&
    !exited.focusClass &&
    !exited.pill &&
    Number(exited.outsideOp) > 0.95;
  return { ok, detail: `inFocus=${JSON.stringify(st)}, exited=${JSON.stringify(exited)}` };
});

// 4. Group selection into section (⌘G)
await record("V14-04", "框选一键打包进分区（⌘G 包裹选中卡片）", async () => {
  await seedCanvas(makeFixture());
  await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.deselectAll();
    c.select(c.nodes.get("n-growth"));
    c.select(c.nodes.get("n-text"));
    c.wrapperEl.focus();
  })()`);
  await sleep(140);
  // Cmd+G (modifiers: 4 = Meta on macOS)
  await h.key("g", { modifiers: 4 });
  await sleep(260);

  const res = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const groups = [...c.nodes.values()].filter(n => n.getData().type === "group");
    const created = groups.find(g => g.id !== "sec-1");
    if (!created) return { found: false };
    const a = c.nodes.get("n-growth");
    const b = c.nodes.get("n-text");
    const wrapsA = created.x <= a.x && created.y <= a.y && created.x + created.width >= a.x + a.width && created.y + created.height >= a.y + a.height;
    const wrapsB = created.x <= b.x && created.y <= b.y && created.x + created.width >= b.x + b.width && created.y + created.height >= b.y + b.height;
    const bg = getComputedStyle(created.containerEl).backgroundColor;
    return { found: true, wrapsA, wrapsB, bg, w: created.width, h: created.height };
  })()`);
  await h.shot(path.join(SHOT_DIR, "04-group-wrap.png"));

  return { ok: !!(res.found && res.wrapsA && res.wrapsB), detail: JSON.stringify(res) };
});

// 5. Card & child-card collapse
await record("V14-05", "卡片与分区内子卡片折叠（48px 标题条 + 保留底色）", async () => {
  await seedCanvas(makeFixture());
  await sleep(200);

  // Click fold button on n-growth and n-child-1
  for (const id of ["n-growth", "n-child-1"]) {
    const pt = await h.evaluate(`(() => {
      const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
      const btn = c.nodes.get(${JSON.stringify(id)}).nodeEl.querySelector('.jce-fold-btn');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    })()`);
    if (!pt) return { ok: false, detail: `fold btn missing on ${id}` };
    await h.click(pt.cx, pt.cy);
    await sleep(200);
  }

  const st = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const inspect = (id) => {
      const n = c.nodes.get(id);
      const d = n.getData();
      const bar = n.nodeEl.querySelector('.jce-collapsed-bar');
      return {
        h: Math.round(n.height),
        folded: d.jceCardFold === true,
        savedH: d.jceFoldH,
        title: bar?.querySelector('.jce-collapsed-title')?.textContent,
        meta: bar?.querySelector('.jce-collapsed-meta')?.textContent,
        bg: getComputedStyle(n.containerEl).backgroundColor,
      };
    };
    return { growth: inspect("n-growth"), child1: inspect("n-child-1") };
  })()`);
  await h.shot(path.join(SHOT_DIR, "05-fold-card-and-child.png"));

  const ok =
    st.growth.folded &&
    st.growth.h <= 52 &&
    st.growth.savedH === 210 &&
    st.growth.meta === "1/2" &&
    st.child1.folded &&
    st.child1.h <= 52 &&
    st.child1.savedH === 150;
  return { ok, detail: JSON.stringify(st) };
});

// 6. Section collapse + drag while folded + expand children follow
await record("V14-06", "分区折叠（隐藏子卡 + 拖动后展开子卡跟随）", async () => {
  const secBtn = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const btn = c.nodes.get("sec-1").nodeEl.querySelector('.jce-fold-btn');
    const r = btn.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
  await h.click(secBtn.cx, secBtn.cy);
  await sleep(240);

  const foldedSt = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const sec = c.nodes.get("sec-1");
    const c1 = c.nodes.get("n-child-1");
    const c2 = c.nodes.get("n-child-2");
    return {
      secH: Math.round(sec.height),
      meta: sec.nodeEl.querySelector('.jce-collapsed-meta')?.textContent,
      c1Hidden: getComputedStyle(c1.nodeEl).display === "none",
      c2Hidden: getComputedStyle(c2.nodeEl).display === "none",
      c1Before: { x: Math.round(c1.x), y: Math.round(c1.y) },
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "06-fold-section.png"));

  // Move collapsed section by (-80, +60) (away from right-side Canvas Undo controls)
  await h.evaluate(`(async () => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const sec = c.nodes.get("sec-1");
    sec.moveAndResize({ x: sec.x - 80, y: sec.y + 60, width: sec.width, height: sec.height });
    c.requestFrame();
    await new Promise(r => setTimeout(r, 200));
  })()`);

  // Expand section back
  const secBtn2 = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const btn = c.nodes.get("sec-1").nodeEl.querySelector('.jce-fold-btn');
    const r = btn.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
  await h.click(secBtn2.cx, secBtn2.cy);
  await sleep(240);

  const afterExpand = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const sec = c.nodes.get("sec-1");
    const c1 = c.nodes.get("n-child-1");
    return {
      secH: Math.round(sec.height),
      c1Visible: getComputedStyle(c1.nodeEl).display !== "none",
      c1After: { x: Math.round(c1.x), y: Math.round(c1.y) },
    };
  })()`);

  const dx = afterExpand.c1After.x - foldedSt.c1Before.x;
  const dy = afterExpand.c1After.y - foldedSt.c1Before.y;
  const ok =
    foldedSt.secH <= 50 &&
    foldedSt.meta === "2 张卡" &&
    foldedSt.c1Hidden &&
    foldedSt.c2Hidden &&
    afterExpand.secH >= 400 &&
    afterExpand.c1Visible &&
    Math.abs(dx - -80) <= 2 &&
    Math.abs(dy - 60) <= 2;
  return { ok, detail: `folded=${JSON.stringify(foldedSt)}, after=${JSON.stringify(afterExpand)}, delta=(${dx},${dy})` };
});

// 7. Reopen persistence
await record("V14-07", "关闭重开画布保留折叠态与原高度", async () => {
  await h.evaluate(`(async () => {
    const leaf = app.workspace.getLeavesOfType("canvas")[0];
    const c = leaf.view.canvas;
    c.requestSave();
    await leaf.view.save?.();
    await new Promise(r => setTimeout(r, 400));
    const file = leaf.view.file;
    leaf.detach();
    await new Promise(r => setTimeout(r, 250));
    await app.workspace.getLeaf(true).openFile(file);
    await new Promise(r => setTimeout(r, 450));
  })()`);

  const reopened = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0]?.view?.canvas;
    if (!c) return { ok: false };
    const g = c.nodes.get("n-growth");
    const ch = c.nodes.get("n-child-1");
    return {
      gFolded: g.getData().jceCardFold === true,
      gH: Math.round(g.height),
      gSavedH: g.getData().jceFoldH,
      gClass: g.nodeEl.classList.contains("jce-card-folded"),
      chFolded: ch.getData().jceCardFold === true,
      chClass: ch.nodeEl.classList.contains("jce-card-folded"),
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "07-fold-reopen.png"));

  const ok =
    reopened.gFolded &&
    reopened.gH <= 52 &&
    reopened.gSavedH === 210 &&
    reopened.gClass &&
    reopened.chFolded &&
    reopened.chClass;
  return { ok, detail: JSON.stringify(reopened) };
});

// 8. Zoom-out LOD (mid ~42% and far ~22%)
await record("V14-08", "缩放语义可读性（中距 ~42% & 远距 ~22% LOD）", async () => {
  await seedCanvas(makeFixture());
  await sleep(200);

  // Mid zoom (~42%, zoom = -1.25 -> scale = 2^-1.25 ≈ 0.42)
  await h.evaluate(`(async () => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.setViewport(160, 0, -1.25);
    c.requestFrame();
    await new Promise(r => setTimeout(r, 300));
  })()`);
  const mid = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const g = c.nodes.get("n-growth");
    const lod = g.nodeEl.querySelector('.jce-lod-overlay');
    return {
      midClass: c.wrapperEl.classList.contains("jce-zoom-mid"),
      lodVisible: !!lod && !lod.hidden,
      title: lod?.querySelector('.jce-lod-title')?.textContent,
      fontSize: lod ? getComputedStyle(lod.querySelector('.jce-lod-title')).fontSize : null,
      secLabelDisplay: getComputedStyle(c.nodes.get("sec-1").nodeEl.querySelector('.canvas-group-label')).display,
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "08-zoom-mid.png"));

  // Far zoom (~22%, zoom = -2.2 -> scale ≈ 0.218, triggers mod-zoomed-out)
  await h.evaluate(`(async () => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.setViewport(160, 0, -2.2);
    c.requestFrame();
    await new Promise(r => setTimeout(r, 300));
  })()`);
  const far = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const g = c.nodes.get("n-growth");
    const lod = g.nodeEl.querySelector('.jce-lod-overlay');
    const secLabel = c.nodes.get("sec-1").nodeEl.querySelector('.canvas-group-label');
    return {
      nativeZoomOut: c.wrapperEl.classList.contains("mod-zoomed-out"),
      farClass: c.wrapperEl.classList.contains("jce-zoom-far"),
      lodVisible: !!lod && !lod.hidden,
      title: lod?.querySelector('.jce-lod-title')?.textContent,
      badge: lod?.querySelector('.jce-lod-badge')?.textContent,
      secLabelDisplay: secLabel ? getComputedStyle(secLabel).display : null,
      secLabelFont: secLabel ? getComputedStyle(secLabel).fontSize : null,
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "09-zoom-far.png"));

  // Zoom back to 100%
  await h.evaluate(`(async () => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.setViewport(0, 0, 0);
    c.requestFrame();
    await new Promise(r => setTimeout(r, 250));
  })()`);
  const restored = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const lod = c.nodes.get("n-growth").nodeEl.querySelector('.jce-lod-overlay');
    return {
      midClass: c.wrapperEl.classList.contains("jce-zoom-mid"),
      farClass: c.wrapperEl.classList.contains("jce-zoom-far"),
      lodHidden: !lod || lod.hidden,
    };
  })()`);

  const ok =
    mid.midClass &&
    mid.lodVisible &&
    far.farClass &&
    far.lodVisible &&
    far.secLabelDisplay !== "none" &&
    !restored.midClass &&
    !restored.farClass &&
    restored.lodHidden;
  return { ok, detail: `mid=${JSON.stringify(mid)}, far=${JSON.stringify(far)}, restored=${JSON.stringify(restored)}` };
});

console.log("\nConsole errors:", h.consoleErrors);
const failed = results.filter((r) => !r.ok);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
h.close();
process.exit(failed.length ? 1 : 0);
