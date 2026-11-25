/**
 * anchors.unit.mjs — unit tests for free-sliding edge anchor geometry.
 * Runs directly with `node tests/anchors.unit.mjs` via esbuild bundle or ts transpilation.
 */

import assert from "node:assert/strict";
import esbuild from "esbuild";

const built = await esbuild.build({
  entryPoints: ["src/anchors.ts"],
  bundle: true,
  format: "esm",
  write: false,
  external: ["obsidian"],
});

const code = built.outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const {
  anchorPoint,
  computeAlignedOffsets,
  nearestSideAndOffset,
  offsetOnSide,
  EDGE_MARGIN,
  CENTER_SNAP_PX,
} = mod;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS: ${name}`);
}

// 1. Default midpoint when offset is undefined
test("anchorPoint falls back to exact 50% midpoint when offset is undefined", () => {
  const bbox = { minX: 100, minY: 200, maxX: 500, maxY: 800 };
  assert.deepEqual(anchorPoint(bbox, "left"), { x: 100, y: 500 });
  assert.deepEqual(anchorPoint(bbox, "right"), { x: 500, y: 500 });
  assert.deepEqual(anchorPoint(bbox, "top"), { x: 300, y: 200 });
  assert.deepEqual(anchorPoint(bbox, "bottom"), { x: 300, y: 800 });
});

// 2. Pixel offset from top stays locked when tall timeline card grows downward
test("pixel offset stays locked to same Y when card height increases", () => {
  const before = { minX: 500, minY: 0, maxX: 900, maxY: 600 };
  const after = { minX: 500, minY: 0, maxX: 900, maxY: 1100 }; // appended more timeline entries
  const ptBefore = anchorPoint(before, "left", 240);
  const ptAfter = anchorPoint(after, "left", 240);
  assert.deepEqual(ptBefore, { x: 500, y: 240 });
  assert.deepEqual(ptAfter, { x: 500, y: 240 });
});

// 3. Clamp offset safely when card shrinks or collapses
test("anchorPoint clamps safely when card collapses to compact title bar", () => {
  const collapsed = { minX: 500, minY: 100, maxX: 900, maxY: 144 }; // height 44
  const pt = anchorPoint(collapsed, "left", 480);
  assert.equal(pt.x, 500);
  assert.equal(pt.y, 144 - EDGE_MARGIN);
});

// 4. Tall card near bottom-left snaps to LEFT side, not BOTTOM (fixes native FL bug)
test("nearestSideAndOffset picks left side near bottom-left of tall card", () => {
  const tall = { minX: 500, minY: 0, maxX: 880, maxY: 700 };
  // Cursor is 5px left of left edge, 80px above bottom edge (y = 620)
  const snap = nearestSideAndOffset(tall, { x: 495, y: 620 });
  assert.equal(snap.side, "left");
  assert.equal(snap.offset, 620);
  assert.equal(snap.snappedToCenter, false);
});

// 5. Center snap within CENTER_SNAP_PX
test("nearestSideAndOffset snaps to center when within threshold", () => {
  const card = { minX: 500, minY: 0, maxX: 880, maxY: 400 }; // center Y = 200
  const snap = nearestSideAndOffset(card, { x: 498, y: 200 + CENTER_SNAP_PX - 2 });
  assert.equal(snap.side, "left");
  assert.equal(snap.offset, undefined);
  assert.equal(snap.snappedToCenter, true);
  assert.deepEqual(snap.point, { x: 500, y: 200 });
});

// 6. Alt-key disables center snap
test("offsetOnSide respects snapCenter=false", () => {
  const card = { minX: 500, minY: 0, maxX: 880, maxY: 400 };
  const snap = offsetOnSide(card, "left", { x: 500, y: 205 }, false);
  assert.equal(snap.snappedToCenter, false);
  assert.equal(snap.offset, 205);
});

// 7. Joy's screenshot scenario: two stacked cards connecting to one tall timeline card
test("computeAlignedOffsets aligns two stacked cards separately onto tall card", () => {
  const tallRight = { x: 520, y: 0, width: 380, height: 700 };
  const topLeft = { x: 40, y: 120, width: 320, height: 220 }; // centerY = 230
  const bottomLeft = { x: 40, y: 440, width: 320, height: 180 }; // centerY = 530

  const topOffsets = computeAlignedOffsets(topLeft, "right", tallRight, "left");
  const bottomOffsets = computeAlignedOffsets(bottomLeft, "right", tallRight, "left");

  assert.equal(topOffsets.toOffset, 230);
  assert.equal(bottomOffsets.toOffset, 530);
  assert.ok(bottomOffsets.toOffset - topOffsets.toOffset === 300);
});

console.log(`\nAll ${passed} unit tests passed.`);
