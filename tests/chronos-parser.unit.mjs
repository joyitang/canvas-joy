/**
 * chronos-parser.unit.mjs — unit tests for Chronos zero-rewrite PDF date parser.
 */

import assert from "node:assert/strict";
import esbuild from "esbuild";

const built = await esbuild.build({
  entryPoints: ["src/chronos-parser.ts"],
  bundle: true,
  format: "esm",
  write: false,
});

const mod = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const { parseDatesFromText, parseManualTime, rangesIntersect, formatYear } = mod;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS: ${name}`);
}

test("parenthesized AD ranges & single years (full/half-width)", () => {
  const r = parseDatesFromText("圣索菲亚大教堂(公元532-537)重建，凡尔登条约（843）签署。");
  assert.equal(r.length, 2);
  assert.equal(r[0].start, 532);
  assert.equal(r[0].end, 537);
  assert.equal(r[1].start, 843);
  assert.equal(r[1].end, 843);
});

test("parenthesized BC ranges & reign years", () => {
  const r = parseDatesFromText("秦朝（公元前221-前207年）统一；【君士坦丁大帝（306-337年在位）】");
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].start, r[0].end], [-221, -207]);
  assert.deepEqual([r[1].start, r[1].end], [306, 337]);
});

test("explicit years & centuries in Byzantine note", () => {
  const text = [
    "### 拜占庭政府",
    "- 5-7世纪的争议",
    "- 8世纪教义争端：圣象（icon）的使用",
    "- 公元800年查理曼加冕，751年怛罗斯之战",
    "- 1054年，教皇和宗主教互相开除教籍",
  ].join("\n");
  const r = parseDatesFromText(text);
  assert.deepEqual(
    r.map((x) => [x.start, x.end]),
    [
      [401, 700],
      [701, 800],
      [800, 800],
      [751, 751],
      [1054, 1054],
    ]
  );
});

test("duration guard skips 在位长达38年 / 持续120年 / 历时30年 / 约20年", () => {
  const r = parseDatesFromText(
    "查士丁尼在位长达38年，战争持续120年，修建历时30年，约20年后衰落，最终于565年去世。"
  );
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].start, r[0].end], [565, 565]);
});

test("skips small bare parenthesized list indices like (1) (2)", () => {
  const r = parseDatesFromText("主要原因(1)经济衰退(2)外敌入侵，最终在476年灭亡。");
  assert.equal(r.length, 1);
  assert.equal(r[0].start, 476);
});

test("manual override parses single, range, BC, and multi-interval strings", () => {
  const r = parseManualTime("公元前221-前207, 532-537, 1054");
  assert.deepEqual(
    r.map((x) => [x.start, x.end]),
    [
      [-221, -207],
      [532, 537],
      [1054, 1054],
    ]
  );
});

test("rangesIntersect matches any overlapping interval", () => {
  const cardRanges = [
    { start: 306, end: 337 },
    { start: 1054, end: 1054 },
  ];
  assert.equal(rangesIntersect(cardRanges, 1024, 1084), true);
  assert.equal(rangesIntersect(cardRanges, 500, 700), false);
  assert.equal(rangesIntersect(cardRanges, 320, 400), true);
});

test("formatYear formats BC and AD cleanly", () => {
  assert.equal(formatYear(-221, true), "前221年");
  assert.equal(formatYear(1054, true), "1054年");
  assert.equal(formatYear(800), "800");
});

test("English historical dates (BC/AD/CE/BCE & centuries)", () => {
  const text =
    "721 BC, 597–586 BC, 2nd century BC, AD 1, AD 30–33, (AD 138–161), 3rd century, 5th–7th century, (1204–1261), AD 1453";
  const r = parseDatesFromText(text);
  assert.deepEqual(
    r.map((x) => [x.start, x.end]),
    [
      [-721, -721],
      [-597, -586],
      [-200, -101],
      [1, 1],
      [30, 33],
      [138, 161],
      [201, 300],
      [401, 700],
      [1204, 1261],
      [1453, 1453],
    ]
  );
});

console.log(`\nAll ${passed} Chronos parser unit tests passed.`);
