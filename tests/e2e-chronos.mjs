/**
 * e2e-chronos.mjs — real CDP interaction & visual verification for Chronos (v1.6.0).
 */

import path from "node:path";
import fs from "node:fs";
import { connect } from "./harness.mjs";

const SHOT_DIR =
  process.env.SHOT_DIR ||
  "/Users/joy/.gemini/antigravity/brain/6f0d0f9e-eccf-499f-bd1b-d105b76110e0/verify-chronos";
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

const FIXTURE = {
  nodes: [
    {
      id: "sec-west",
      type: "group",
      label: "西欧 · 法兰克",
      x: -500,
      y: -80,
      width: 390,
      height: 540,
      jce: "section",
    },
    {
      id: "n-charles",
      type: "text",
      text: "### 查理曼帝国\n\n- 公元800年，教皇利奥三世为查理曼加冕\n- 凡尔登条约（843）三分帝国",
      x: -470,
      y: -30,
      width: 330,
      height: 190,
      jce: "note",
      jceBg: "#dfeaf7",
    },
    {
      id: "n-undated",
      type: "text",
      text: "### 中世纪总论（无日期卡片）\n\n- 封建制度与庄园经济\n- 教权与王权长期博弈",
      x: -470,
      y: 220,
      width: 330,
      height: 180,
      jce: "note",
      jceBg: "#fbf7ee",
    },
    {
      id: "sec-east",
      type: "group",
      label: "东欧 · 拜占庭",
      x: -40,
      y: -80,
      width: 440,
      height: 540,
      jce: "section",
    },
    {
      id: "n-justinian",
      type: "text",
      text: "### 查士丁尼一世\n\n- 在位长达38年，重建圣索菲亚大教堂(公元532-537)\n- 编纂《查士丁尼法典》",
      x: -10,
      y: -30,
      width: 380,
      height: 185,
      jce: "note",
      jceBg: "#e3f1d9",
    },
    {
      id: "n-schism",
      type: "text",
      text: "### 基督教东西大分裂\n\n- 1054年，罗马教皇与君士坦丁堡宗主教互相开除教籍\n- 标志着天主教与东正教正式分裂",
      x: -10,
      y: 215,
      width: 380,
      height: 190,
      jce: "note",
      jceBg: "#fbf1c4",
    },
  ],
  edges: [],
};

// Wait for plugin + seed multi-region history fixture
await h.evaluate(`(async () => {
  for (let i = 0; i < 40; i++) {
    const leaf = app.workspace.getLeavesOfType("canvas")[0];
    if (leaf?.view?.canvas && app.plugins?.enabledPlugins?.has("canvas-joy")) {
      app.workspace.setActiveLeaf(leaf, { focus: true });
      const c = leaf.view.canvas;
      c.importData(${JSON.stringify(FIXTURE)}, true);
      c.zoomToBbox({ minX: -540, minY: -120, maxX: 440, maxY: 540 });
      c.requestFrame();
      await new Promise(r => setTimeout(r, 450));
      return true;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error("Canvas or canvas-joy plugin did not initialize");
})()`);

// CH-01: Default OFF state is 100% clean
await record("CH-01", "关闭态零打扰（无时间轴浮条、无日期下划线）", async () => {
  const state = await h.evaluate(`(() => ({
    bar: !!document.querySelector(".jce-chronos-bar"),
    dates: document.querySelectorAll(".jce-chronos-date").length,
    modeClass: !!document.querySelector(".jce-chronos-mode"),
    btn: !!document.querySelector('.jce-tool[data-tool="chronos"]'),
  }))()`);
  await h.shot(path.join(SHOT_DIR, "01-chronos-off.png"));
  return {
    ok: !state.bar && state.dates === 0 && !state.modeClass && state.btn,
    detail: JSON.stringify(state),
  };
});

// CH-02: Click hourglass toolbar button -> bar appears + dates underlined (duration skipped)
await record("CH-02", "开启 Chronos（底部极简时间轴 + 正文日期虚线下划线 + 跳过时长词）", async () => {
  const btnPos = await h.evaluate(`(() => {
    const b = document.querySelector('.jce-tool[data-tool="chronos"]');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await h.click(btnPos.x, btnPos.y);
  await sleep(300);

  const info = await h.evaluate(`(() => {
    const bar = document.querySelector(".jce-chronos-bar");
    const range = bar?.querySelector(".jce-chronos-range")?.textContent ?? "";
    const count = bar?.querySelector(".jce-chronos-count")?.textContent ?? "";
    const spans = [...document.querySelectorAll(".jce-chronos-date")].map(s => s.textContent);
    return { hasBar: !!bar, range, count, spans };
  })()`);
  await h.shot(path.join(SHOT_DIR, "02-chronos-on.png"));

  const skippedDuration = !info.spans.some((s) => s.includes("38年"));
  const hasKeyDates =
    info.spans.some((s) => s.includes("532-537")) &&
    info.spans.some((s) => s.includes("800年")) &&
    info.spans.some((s) => s.includes("843")) &&
    info.spans.some((s) => s.includes("1054年"));

  return {
    ok: info.hasBar && info.range === "532 — 1054" && info.count === "3/3" && skippedDuration && hasKeyDates,
    detail: `range="${info.range}", count="${info.count}", spans=${JSON.stringify(info.spans)}`,
  };
});

// CH-03: Click "1054年" once -> focuses to 1024-1084 (±30y), dims others, keeps undated; click again -> resets
await record("CH-03", "单击正文日期聚焦（±30年同期窗口 + 保留无日期卡），再点一次恢复全范围", async () => {
  const spanPos = await h.evaluate(`(() => {
    const s = [...document.querySelectorAll(".jce-chronos-date")].find(el => el.textContent.includes("1054年"));
    const r = s.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await h.click(spanPos.x, spanPos.y);
  await sleep(260);

  const focused = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const bar = document.querySelector(".jce-chronos-bar");
    return {
      range: bar?.querySelector(".jce-chronos-range")?.textContent ?? "",
      count: bar?.querySelector(".jce-chronos-count")?.textContent ?? "",
      schismDim: c.nodes.get("n-schism").nodeEl.classList.contains("jce-chronos-dim"),
      justinianDim: c.nodes.get("n-justinian").nodeEl.classList.contains("jce-chronos-dim"),
      charlesDim: c.nodes.get("n-charles").nodeEl.classList.contains("jce-chronos-dim"),
      undatedDim: c.nodes.get("n-undated").nodeEl.classList.contains("jce-chronos-dim"),
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "03-date-click-focused.png"));

  // Click same date again -> restores full range
  await h.click(spanPos.x, spanPos.y);
  await sleep(220);
  const restored = await h.evaluate(`(() => {
    const bar = document.querySelector(".jce-chronos-bar");
    return {
      range: bar?.querySelector(".jce-chronos-range")?.textContent ?? "",
      count: bar?.querySelector(".jce-chronos-count")?.textContent ?? "",
    };
  })()`);

  const ok =
    focused.range === "1024 — 1054" &&
    focused.count === "1/3" &&
    !focused.schismDim &&
    focused.justinianDim &&
    focused.charlesDim &&
    !focused.undatedDim &&
    restored.range === "532 — 1054" &&
    restored.count === "3/3";

  return {
    ok,
    detail: `focused=${JSON.stringify(focused)}, restored=${JSON.stringify(restored)}`,
  };
});

// CH-04: Reset button is hidden at full range, appears when sliced, and resets cleanly
await record("CH-04", "极简控制栏：全范围隐藏「重置」，点击日期后浮出「↺ 重置」并可一键恢复", async () => {
  const hiddenInitially = await h.evaluate(`(() => {
    const r = document.querySelector('.jce-chronos-action[data-act="reset"]');
    const removedMode = !document.querySelector('[data-act="mode"]');
    const removedUndated = !document.querySelector('[data-act="undated"]');
    return { resetHidden: !!r && r.hidden, removedMode, removedUndated };
  })()`);

  const date800Pos = await h.evaluate(`(() => {
    const s = [...document.querySelectorAll(".jce-chronos-date")].find(el => el.textContent.includes("800年"));
    const r = s.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await h.click(date800Pos.x, date800Pos.y);
  await sleep(240);

  const sliced = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const r = document.querySelector('.jce-chronos-action[data-act="reset"]');
    const rect = r.getBoundingClientRect();
    return {
      resetVisible: !r.hidden && rect.width > 0,
      resetX: rect.left + rect.width / 2,
      resetY: rect.top + rect.height / 2,
      charlesDim: c.nodes.get("n-charles").nodeEl.classList.contains("jce-chronos-dim"),
      schismDim: c.nodes.get("n-schism").nodeEl.classList.contains("jce-chronos-dim"),
      undatedDim: c.nodes.get("n-undated").nodeEl.classList.contains("jce-chronos-dim"),
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "04-minimal-bar-sliced.png"));

  return {
    ok:
      hiddenInitially.resetHidden &&
      hiddenInitially.removedMode &&
      hiddenInitially.removedUndated &&
      sliced.resetVisible &&
      !sliced.charlesDim &&
      sliced.schismDim &&
      !sliced.undatedDim,
    detail: JSON.stringify({ hiddenInitially, sliced }),
  };
});

// CH-05: Manual override `jceTime: "800"` on undated card -> stays matched without modifying text, then click Reset
await record("CH-05", "手动指定 jceTime 覆盖年份 + 点击「↺ 重置」恢复全范围", async () => {
  const res = await h.evaluate(`(async () => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const n = c.nodes.get("n-undated");
    const origText = n.text;
    n.setData({ ...n.getData(), jceTime: "800" });
    c.requestSave();
    c.requestFrame();
    await new Promise(r => setTimeout(r, 350));
    const countAfter = document.querySelector(".jce-chronos-count")?.textContent ?? "";
    return {
      textUnchanged: n.text === origText,
      jceTime: n.getData().jceTime,
      undatedMatch: n.nodeEl.classList.contains("jce-chronos-match"),
      countAfter,
    };
  })()`);

  // Click Reset button -> restores full range and hides reset button again
  const resetPos = await h.evaluate(`(() => {
    const r = document.querySelector('.jce-chronos-action[data-act="reset"]');
    const rect = r.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await h.click(resetPos.x, resetPos.y);
  await sleep(220);

  const afterReset = await h.evaluate(`(() => ({
    range: document.querySelector(".jce-chronos-range")?.textContent ?? "",
    resetHidden: document.querySelector('.jce-chronos-action[data-act="reset"]')?.hidden === true,
  }))()`);

  return {
    ok:
      res.textUnchanged &&
      res.jceTime === "800" &&
      res.undatedMatch &&
      res.countAfter === "2/4" &&
      afterReset.range === "532 — 1054" &&
      afterReset.resetHidden,
    detail: JSON.stringify({ res, afterReset }),
  };
});

// CH-06: Multi-period tall card intra-card block dimming (Joy's Byzantine scenario)
await record("CH-06", "多时期大卡内条目级淡化（命中行清晰 + 保留父级大纲，非同期条目与背景段淡化至 15%）", async () => {
  const byzFixture = {
    nodes: [
      {
        id: "n-debate",
        type: "text",
        text: "### 基督教的争论：基督是人类，还只是神？（5-7世纪）\n\n1. 基督既是完美的神，同时又是完美的人\n2. 基督只具有一种属性（基督一性论者）",
        x: -440,
        y: 20,
        width: 340,
        height: 220,
        jce: "note",
        jceBg: "#fbf7ee",
      },
      {
        id: "n-split",
        type: "text",
        text: "### 基督教分裂（1054年）\n\n- 罗马（西欧）-> 教皇 天主教\n- 君士坦丁堡 -> 教宗 东正教",
        x: -440,
        y: 320,
        width: 340,
        height: 170,
        jce: "note",
        jceBg: "#fbf7ee",
      },
      {
        id: "n-byz",
        type: "text",
        text: [
          "### 拜占庭政府",
          "",
          "- 政治机构繁琐",
          "  - 【君士坦丁大帝（306-337年在位）】",
          "  - 【狄奥多西一世（378-395年在位）】",
          "- 基督教会",
          "  - 基督教为主导地位宗教（东正教）",
          "  - 5-7世纪的争议",
          "  - 8世纪教义争端：圣象（icon）的使用",
          "    - 拜占庭帝国推行圣象破坏政策",
          "  - 1054年，教皇和宗主教互相开除教籍",
          "    - 罗马天主教与君士坦丁堡东正教",
          "- 文化",
          "  - 官方语言希腊语，摒弃拉丁语",
        ].join("\n"),
        x: -30,
        y: -40,
        width: 440,
        height: 580,
        jce: "note",
        jceBg: "#ffffff",
      },
    ],
    edges: [],
  };

  await h.evaluate(`(async () => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    c.importData(${JSON.stringify(byzFixture)}, true);
    c.zoomToBbox({ minX: -480, minY: -80, maxX: 460, maxY: 600 });
    c.requestFrame();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100));
      c.requestFrame();
      if (c.nodes.get("n-debate")?.nodeEl?.querySelector(".jce-chronos-date")) break;
    }
  })()`);

  // Click "5-7世纪" on the debate card
  const pos57 = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const s = c.nodes.get("n-debate").nodeEl.querySelector(".jce-chronos-date");
    const r = s.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await h.click(pos57.x, pos57.y);
  await sleep(280);

  const check = await h.evaluate(`(() => {
    const c = app.workspace.getLeavesOfType("canvas")[0].view.canvas;
    const debateDimBlocks = c.nodes.get("n-debate").nodeEl.querySelectorAll(".jce-chronos-block-dim").length;
    const splitCardDim = c.nodes.get("n-split").nodeEl.classList.contains("jce-chronos-dim");
    const byzEl = c.nodes.get("n-byz").nodeEl;
    const lis = [...byzEl.querySelectorAll("li")];
    const findLeafLi = (kw) => lis.filter(li => (li.textContent || "").includes(kw)).pop();
    const isDim = (li) => !!li && (li.classList.contains("jce-chronos-block-dim") || !!li.closest(".jce-chronos-block-dim"));
    const li57 = findLeafLi("5-7世纪的争议");
    const liChurch = lis.find(li => (li.textContent || "").trim().startsWith("基督教会"));
    const li1054 = findLeafLi("1054年，教皇");
    const li306 = findLeafLi("306-337");
    const liCulture = findLeafLi("官方语言希腊语");
    return {
      debateDimBlocks,
      splitCardDim,
      hit57: !!li57 && li57.classList.contains("jce-chronos-block-hit") && !isDim(li57),
      churchClear: !!liChurch && !isDim(liChurch),
      dim1054: isDim(li1054),
      dim306: isDim(li306),
      dimCulture: isDim(liCulture),
    };
  })()`);
  await h.shot(path.join(SHOT_DIR, "05-byzantine-block-dim.png"));

  return {
    ok:
      check.debateDimBlocks === 0 &&
      check.splitCardDim &&
      check.hit57 &&
      check.churchClear &&
      check.dim1054 &&
      check.dim306 &&
      check.dimCulture,
    detail: JSON.stringify(check),
  };
});

// CH-07: Close Chronos -> bar gone, all date spans cleanly unwrapped, 0 errors
await record("CH-07", "关闭 Chronos 彻底恢复原生纯净态（零残留）", async () => {
  const closePos = await h.evaluate(`(() => {
    const b = document.querySelector(".jce-chronos-close");
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await h.click(closePos.x, closePos.y);
  await sleep(220);

  const after = await h.evaluate(`(() => ({
    bar: !!document.querySelector(".jce-chronos-bar"),
    dates: document.querySelectorAll(".jce-chronos-date").length,
    modeClass: !!document.querySelector(".jce-chronos-mode"),
    dimNodes: document.querySelectorAll(".jce-chronos-dim").length,
  }))()`);
  return {
    ok: !after.bar && after.dates === 0 && !after.modeClass && after.dimNodes === 0,
    detail: JSON.stringify(after),
  };
});

console.log("\nConsole errors:", h.consoleErrors.length ? h.consoleErrors : "none");
const failed = results.filter((r) => !r.ok);
h.close();
process.exit(failed.length ? 1 : 0);
