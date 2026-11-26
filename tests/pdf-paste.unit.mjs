import assert from "node:assert/strict";

// Inline-test compiled cleanPdfText logic via esbuild or direct TS transpilation
import { buildSync } from "esbuild";

const out = buildSync({
  entryPoints: ["src/pdf-paste.ts"],
  bundle: false,
  format: "esm",
  write: false,
});
const code = out.outputFiles[0].text;
// Load just cleanPdfText via data URL (stripping imports)
const stripped = code
  .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
  .replace(/export class PdfPasteController[\s\S]*$/, "");
const mod = await import(`data:text/javascript;base64,${Buffer.from(stripped).toString("base64")}`);
const { cleanPdfText } = mod;

// 1. Real paragraph copied from 《欧洲中世纪史（第11版）》 page 7
const realChinesePdf = `30多年来，沃伦•霍利斯特以其独特的历史观及迷人的风格为《欧洲中
世纪史》注入了活力。即便这已是我着手参与的第三版，书中也依然留有他的印
记，但他已不再是直接的作者。`;

const r1 = cleanPdfText(realChinesePdf);
assert.equal(r1.changed, true);
assert.equal(
  r1.text,
  "30多年来，沃伦•霍利斯特以其独特的历史观及迷人的风格为《欧洲中世纪史》注入了活力。即便这已是我着手参与的第三版，书中也依然留有他的印记，但他已不再是直接的作者。"
);
console.log("  ✓ Real Chinese PDF hard-wraps joined with zero stray spaces");

// 2. Real multi-paragraph PDF text preserves blank line paragraph breaks
const multiPara = `第一章现在囊括了原先两章解说的内容，这样能让学生更快进入公元500
年之后的古代西罗马帝国的世界。

我们牢牢植根于西方，才能梳理出更连贯而富有质感的历史，同时也能更多
地探讨女性史、社会史和中世纪晚期史。`;
const r2 = cleanPdfText(multiPara);
assert.equal(r2.changed, true);
assert.equal(r2.text.split("\n\n").length, 2);
assert.ok(!r2.text.includes("500\n年"));
assert.ok(!r2.text.includes("更多\n地"));
console.log("  ✓ Multi-paragraph breaks preserved while mid-sentence wraps cleaned");

// 3. English PDF hyphenation and space join
const enPdf = `The Roman Empire under-
went profound transfor-
mation in the fourth
century.`;
const r3 = cleanPdfText(enPdf);
assert.equal(r3.changed, true);
assert.equal(r3.text, "The Roman Empire underwent profound transformation in the fourth century.");
console.log("  ✓ English hyphenation & line-wraps cleaned");

// 4. Markdown headings, lists, and fenced code blocks are untouched
const mdList = `# Title\n- item one\n- item two`;
assert.equal(cleanPdfText(mdList).changed, false);

const codeBlock = "```js\nconst a =\n  1;\n```";
assert.equal(cleanPdfText(codeBlock).changed, false);
console.log("  ✓ Markdown headings, lists, and code blocks untouched");

console.log("ALL PDF PASTE UNIT TESTS PASSED!");
