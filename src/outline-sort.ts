/**
 * outline-sort.ts — sorting helpers for Section Outline.
 *
 * Supports:
 *  - "order": creation order (canvas node insertion order) with optional user drag-reordering
 *  - "name": natural Chinese/English sorting (e.g. 序章 < 第一章 < 第二章 < 第十章, 1. < 2. < 10.)
 */

export type OutlineSortMode = "order" | "name";

export interface OutlinePrefs {
  sortMode?: OutlineSortMode;
  /** Manually reordered section node IDs for this canvas file. */
  customOrder?: string[];
  /** Custom floating drawer position relative to canvas view (default top-left). */
  pos?: { x: number; y: number };
}

export interface SectionEntry {
  id: string;
  label: string;
  cardCount: number;
  folded: boolean;
  creationIndex: number;
}

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function parseChineseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let current = 0;
  let matched = false;
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      current = CN_DIGIT[ch];
      matched = true;
    } else if (ch === "十") {
      total += (current || 1) * 10;
      current = 0;
      matched = true;
    } else if (ch === "百") {
      total += (current || 1) * 100;
      current = 0;
      matched = true;
    } else if (ch === "千") {
      total += (current || 1) * 1000;
      current = 0;
      matched = true;
    } else {
      return null;
    }
  }
  if (!matched) return null;
  return total + current;
}

const FRONT_MATTER_RE = /^(?:导言|序言|序章|前言|自序|译序|绪论|引言)/;
const BACK_MATTER_RE = /^(?:结语|后记|跋|附录|专业术语表|术语表|索引|参考文献)/;
const CHAPTER_PREFIX_RE =
  /^(?:第([零〇一二两三四五六七八九十百千0-9]+)[章编部篇回节]|Ch(?:apter)?\.?\s*(\d+)|Part\s*(\d+)|(\d+)(?:\.\d+)?[\s.、:：\-])/i;

function naturalRank(label: string): { bucket: number; num: number; text: string } {
  const s = label.trim();
  if (FRONT_MATTER_RE.test(s)) return { bucket: 0, num: 0, text: s };
  if (BACK_MATTER_RE.test(s)) return { bucket: 3, num: 0, text: s };
  const m = CHAPTER_PREFIX_RE.exec(s);
  if (m) {
    const rawNum = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    const parsed = parseChineseNumber(rawNum);
    if (parsed !== null) {
      return { bucket: 1, num: parsed, text: s };
    }
  }
  return { bucket: 2, num: 0, text: s };
}

export function compareSectionNames(a: string, b: string): number {
  const ra = naturalRank(a);
  const rb = naturalRank(b);
  if (ra.bucket !== rb.bucket) return ra.bucket - rb.bucket;
  if (ra.num !== rb.num) return ra.num - rb.num;
  return ra.text.localeCompare(rb.text, "zh-CN", { numeric: true, sensitivity: "base" });
}

export function sortSections(
  entries: SectionEntry[],
  mode: OutlineSortMode,
  customOrder?: string[]
): SectionEntry[] {
  const list = entries.slice();
  if (mode === "name") {
    list.sort((a, b) => compareSectionNames(a.label, b.label) || a.creationIndex - b.creationIndex);
    return list;
  }

  // Default: creation order, overridden by custom drag order when present
  if (customOrder && customOrder.length > 0) {
    const rank = new Map<string, number>();
    customOrder.forEach((id, idx) => rank.set(id, idx));
    list.sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.creationIndex - b.creationIndex;
    });
    return list;
  }

  list.sort((a, b) => a.creationIndex - b.creationIndex);
  return list;
}

/** Reorder `ids` by moving `dragId` before or after `targetId`. */
export function reorderIds(
  currentIds: string[],
  dragId: string,
  targetId: string,
  placeAfter: boolean
): string[] {
  if (dragId === targetId) return currentIds.slice();
  const next = currentIds.filter((id) => id !== dragId);
  const idx = next.indexOf(targetId);
  if (idx === -1) {
    next.push(dragId);
    return next;
  }
  next.splice(placeAfter ? idx + 1 : idx, 0, dragId);
  return next;
}
