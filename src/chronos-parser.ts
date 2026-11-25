/**
 * chronos-parser.ts — zero-rewrite historical date & range parser for PDF text.
 *
 * Extracts year points and ranges directly from pasted PDF/book notes without
 * requiring custom `@year` syntax:
 *  - Parenthesized dates (full/half-width): (公元532-537), （843）, （公元前221-前207年）, （306-337年在位）, （5-7世纪）
 *  - Explicit dates: 公元800年, 公元前221-前207年, 751年, 1054年, 306-337年, 5-7世纪, 8世纪
 *  - Duration guard: skips durations preceded by 长达 / 持续 / 历时 / 在位 / 享年 / 约 (e.g. 在位长达38年)
 *  - Manual override (`jceTime`): parses user-specified years/ranges like `1054`, `532-537`, `前221-前207, 800`
 */

export interface TimeRange {
  start: number;
  end: number;
  raw: string;
  index: number;
  length: number;
}

/** Node hidden property storing manual time override in `.canvas`. */
export const TIME_OVERRIDE = "jceTime";

/** Duration prefixes that indicate a span length rather than a calendar year. */
const DURATION_PREFIX_RE = /(?:长达|持续|历时|在位|享年|共计|共|达|超过|将近|近|约|大约|前后|不足|逾|余)\s*$/;

/**
 * Century to year range (standard historical convention):
 *  - 8世纪 -> [701, 800]
 *  - 公元前5世纪 -> [-500, -401]
 */
export function centuryToRange(century: number, bc: boolean): { start: number; end: number } {
  const c = Math.max(1, Math.floor(century));
  if (bc) {
    return { start: -c * 100, end: -(c - 1) * 100 - 1 };
  }
  return { start: (c - 1) * 100 + 1, end: c * 100 };
}

function normalizeRange(a: number, b: number): { start: number; end: number } {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

function isPlausibleYear(y: number, hasExplicitEraOrUnit: boolean): boolean {
  if (!Number.isFinite(y) || y === 0) return false;
  if (y < -4000 || y > 2200) return false;
  // Bare parenthesized numbers without 公元/前/年 (e.g. "(1)", "(12)") are list indices, not years.
  if (!hasExplicitEraOrUnit && y > 0 && y < 100) return false;
  return true;
}

/**
 * Parse a single date expression (without outer parentheses) into a start/end year.
 * Returns null if not a valid historical year or century expression.
 */
function parseDateCore(
  core: string,
  allowBareNumber: boolean
): { start: number; end: number; explicitEra: boolean } | null {
  const s = core.trim();
  if (!s) return null;

  // 1a. English century range or single century: e.g. 5th–7th century, 2nd century BC, 3rd century AD
  const enCentRe = /^(\d{1,2})(?:st|nd|rd|th)\s*(?:[-–—~]\s*(\d{1,2})(?:st|nd|rd|th)\s*)?(?:century|centuries)(?:\s*(BCE|BC|CE|AD))?$/i;
  const ecm = s.match(enCentRe);
  if (ecm) {
    const c1 = Number(ecm[1]);
    const c2Str = ecm[2];
    const era = (ecm[3] ?? "").toUpperCase();
    const bc = era === "BC" || era === "BCE";
    if (c1 < 1 || c1 > 30) return null;
    const r1 = centuryToRange(c1, bc);
    if (!c2Str) return { start: r1.start, end: r1.end, explicitEra: true };
    const c2 = Number(c2Str);
    if (c2 < 1 || c2 > 30) return null;
    const r2 = centuryToRange(c2, bc);
    return { ...normalizeRange(Math.min(r1.start, r2.start), Math.max(r1.end, r2.end)), explicitEra: true };
  }

  // 1b. English AD/CE/BC/BCE year or range: e.g. AD 532–537, 597–586 BC, 721 BC, AD 1, 476 AD
  const enYearRe = /^(?:(AD|CE)\s*)?(\d{1,4})\s*(?:(BCE|BC|CE|AD)\s*)?(?:[-–—~]\s*(?:(AD|CE)\s*)?(\d{1,4})\s*(BCE|BC|CE|AD)?)?$/i;
  const eym = s.match(enYearRe);
  if (eym && (eym[1] || eym[3] || eym[4] || eym[6])) {
    const pre1 = (eym[1] ?? "").toUpperCase();
    const n1 = Number(eym[2]);
    const post1 = (eym[3] ?? "").toUpperCase();
    const pre2 = (eym[4] ?? "").toUpperCase();
    const n2Str = eym[5];
    const post2 = (eym[6] ?? "").toUpperCase();

    const era1 = pre1 || post1;
    const era2 = pre2 || post2;

    if (!n2Str) {
      const bc = era1 === "BC" || era1 === "BCE";
      const y = bc ? -n1 : n1;
      if (!isPlausibleYear(y, true)) return null;
      return { start: y, end: y, explicitEra: true };
    }
    const n2 = Number(n2Str);
    const bc1 = era1 ? era1 === "BC" || era1 === "BCE" : era2 === "BC" || era2 === "BCE";
    const bc2 = era2 ? era2 === "BC" || era2 === "BCE" : bc1 && n2 < n1;
    const y1 = bc1 ? -n1 : n1;
    const y2 = bc2 ? -n2 : n2;
    if (!isPlausibleYear(y1, true) || !isPlausibleYear(y2, true)) return null;
    return { ...normalizeRange(y1, y2), explicitEra: true };
  }

  // 1. Chinese century range or single century: e.g. 公元前5-前3世纪, 5-7世纪, 8世纪
  const centRe = /^(公元前|公元|前)?\s*(\d{1,2})\s*(?:[-–—~～至到]\s*(公元前|公元|前)?\s*(\d{1,2})\s*)?世纪$/;
  const cm = s.match(centRe);
  if (cm) {
    const era1 = cm[1] ?? "";
    const c1 = Number(cm[2]);
    const era2 = cm[3] ?? "";
    const c2Str = cm[4];
    if (c1 < 1 || c1 > 30) return null;
    const bc1 = era1.includes("前");
    const r1 = centuryToRange(c1, bc1);
    if (!c2Str) {
      return { start: r1.start, end: r1.end, explicitEra: true };
    }
    const c2 = Number(c2Str);
    if (c2 < 1 || c2 > 30) return null;
    // If start is BC and end has no explicit "公元", assume BC unless c2 > c1?
    // Historically "公元前5-前3世纪" or "公元前5-3世纪" both mean BC; "公元前2-公元2世纪" switches to AD.
    const bc2 = era2 ? era2.includes("前") : bc1;
    const r2 = centuryToRange(c2, bc2);
    const norm = normalizeRange(Math.min(r1.start, r2.start), Math.max(r1.end, r2.end));
    return { ...norm, explicitEra: true };
  }

  // 2. Year range: e.g. 公元532-537年, 公元前221-前207年, 306-337年, 532-537
  const rangeRe = /^(公元前|公元|前)?\s*(\d{1,4})\s*年?\s*[-–—~～至到]\s*(公元前|公元|前)?\s*(\d{1,4})\s*(年)?$/;
  const rm = s.match(rangeRe);
  if (rm) {
    const era1 = rm[1] ?? "";
    const n1 = Number(rm[2]);
    const era2 = rm[3] ?? "";
    const n2 = Number(rm[4]);
    const hasYearUnit = Boolean(rm[5]);
    const explicitEra = Boolean(era1 || era2);
    if (!allowBareNumber && !explicitEra && !hasYearUnit) return null;

    const bc1 = era1.includes("前");
    const bc2 = era2 ? era2.includes("前") : bc1 && n2 < n1;
    const y1 = bc1 ? -n1 : n1;
    const y2 = bc2 ? -n2 : n2;

    if (!isPlausibleYear(y1, explicitEra || hasYearUnit) || !isPlausibleYear(y2, explicitEra || hasYearUnit)) {
      return null;
    }
    // Reject tiny bare ranges like (1-3) unless explicit era/unit
    if (!explicitEra && !hasYearUnit && Math.max(Math.abs(y1), Math.abs(y2)) < 100) {
      return null;
    }
    return { ...normalizeRange(y1, y2), explicitEra };
  }

  // 3. Single year: e.g. 公元前221年, 公元800年, 1054年, 843
  const singleRe = /^(公元前|公元|前)?\s*(\d{1,4})\s*(年)?$/;
  const sm = s.match(singleRe);
  if (sm) {
    const era = sm[1] ?? "";
    const n = Number(sm[2]);
    const hasYearUnit = Boolean(sm[3]);
    const explicitEra = Boolean(era);
    if (!allowBareNumber && !explicitEra && !hasYearUnit) return null;

    const y = era.includes("前") ? -n : n;
    if (!isPlausibleYear(y, explicitEra || hasYearUnit)) return null;
    return { start: y, end: y, explicitEra };
  }

  return null;
}

/**
 * Combined regex scanning text for candidate date tokens in priority order:
 *  Group 1: Parenthesized date (allowing trailing qualifier like 在位/年间/左右 inside parens)
 *  Group 2: Explicit century / century range outside parens
 *  Group 3: Explicit year / year range outside parens (must have 公元/前 or trailing 年)
 */
const DATE_TOKEN_RE = new RegExp(
  [
    // 1. Parenthesized (Chinese or English): (公元532-537), （843）, (AD 138–161), (31 BC), (1204–1261), (5th–7th century)
    String.raw`([（(]\s*(?:约\s*|c\.\s*)?(?:(?:公元前|公元|前|AD|CE)\s*)?\d{1,4}(?:st|nd|rd|th)?\s*(?:年\s*|BCE\s*|BC\s*|CE\s*|AD\s*)?(?:[-–—~～至到]\s*(?:(?:公元前|公元|前|AD|CE)\s*)?\d{1,4}(?:st|nd|rd|th)?\s*)?(?:年|世纪|centuries|century|BCE|BC|CE|AD)?(?:\s*(?:BCE|BC|CE|AD|在位|年间|左右|前后|期间))?\s*[)）])`,
    // 2. Explicit Chinese century outside parens: 公元前5-前3世纪, 5-7世纪, 8世纪
    String.raw`((?:公元前|公元|前)?\s*\d{1,2}\s*(?:[-–—~～至到]\s*(?:公元前|公元|前)?\s*\d{1,2}\s*)?世纪)`,
    // 3. Explicit English century outside parens: 2nd century BC, 5th–7th century, 3rd century
    String.raw`(\b\d{1,2}(?:st|nd|rd|th)\s*(?:[-–—~]\s*\d{1,2}(?:st|nd|rd|th)\s*)?(?:centuries|century)(?:\s*(?:BCE|BC|CE|AD)\b)?)`,
    // 4. Explicit English AD/CE/BC/BCE year or range: AD 532–537, 597–586 BC, 721 BC, AD 1, 476 AD
    String.raw`(\b(?:AD|CE)\s+\d{1,4}(?:\s*[-–—~]\s*(?:(?:AD|CE)\s+)?\d{1,4})?\b|\b\d{1,4}\s*[-–—~]\s*\d{1,4}\s*(?:BCE|BC|CE|AD)\b|\b\d{1,4}\s*(?:BCE|BC|CE|AD)\b)`,
    // 5. Explicit Chinese year or year range outside parens:
    //    - with era prefix: 公元前221-前207年, 公元800年, 公元前49
    //    - or with trailing 年: 1054年, 306-337年, 751年
    String.raw`((?:公元前|公元)\s*\d{1,4}\s*(?:年\s*)?(?:[-–—~～至到]\s*(?:(?:公元前|公元|前)\s*)?\d{1,4}\s*)?年?|\b\d{1,4}\s*[-–—~～至到]\s*(?:(?:公元前|公元|前)\s*)?\d{1,4}\s*年|(?<![\d.])\d{1,4}\s*年)`,
  ].join("|"),
  "gi"
);

/**
 * Extract all valid historical dates & ranges from raw card text.
 */
export function parseDatesFromText(text: string): TimeRange[] {
  if (!text) return [];
  const results: TimeRange[] = [];

  DATE_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = DATE_TOKEN_RE.exec(text)) !== null) {
    const raw = m[0];
    const index = m.index;
    const isParen = Boolean(m[1]);

    // Strip outer parens & trailing qualifiers like 在位/年间/左右/约
    let inner = raw;
    if (isParen) {
      inner = raw
        .slice(1, -1)
        .trim()
        .replace(/^(?:约|c\.)\s*/i, "")
        .replace(/\s*(?:在位|年间|左右|前后|期间)$/, "")
        .trim();
    }

    const parsed = parseDateCore(inner, isParen);
    if (!parsed) continue;

    // Guard against durations like "在位长达38年", "持续100年", "约30年"
    // Note: "约公元800年" has explicitEra=true so it is preserved;
    // "（306-337年在位）" has "在位" AFTER the year, so prefix check passes.
    if (!isParen && !parsed.explicitEra) {
      const lookbehind = text.slice(Math.max(0, index - 8), index);
      if (DURATION_PREFIX_RE.test(lookbehind)) continue;
      // Single non-era year like "38年" (1..99 without 公元/前) is almost always a duration in Chinese prose
      if (parsed.start === parsed.end && parsed.start > 0 && parsed.start < 100) {
        continue;
      }
    }

    results.push({
      start: parsed.start,
      end: parsed.end,
      raw,
      index,
      length: raw.length,
    });
  }

  return results;
}

/**
 * Parse manual override field (`jceTime`), e.g.:
 *  - "1054"
 *  - "532-537"
 *  - "-221..-207" / "前221-前207" / "公元前221-前207年"
 *  - "532-537, 1054" (comma / semicolon /顿号 separated)
 */
export function parseManualTime(raw: string): TimeRange[] {
  if (!raw || !raw.trim()) return [];
  const parts = raw.split(/[,，;；、]+/);
  const out: TimeRange[] = [];

  for (const part of parts) {
    const token = part.trim();
    if (!token) continue;

    // Support negative year syntax like "-221" or "-221..-207" or "-221 ~ -207"
    const negRange = token.match(/^(-?\d{1,4})\s*(?:\.\.|~|～|至|到)\s*(-?\d{1,4})$/);
    if (negRange) {
      const a = Number(negRange[1]);
      const b = Number(negRange[2]);
      if (isPlausibleYear(a, true) && isPlausibleYear(b, true)) {
        const norm = normalizeRange(a, b);
        out.push({ ...norm, raw: token, index: 0, length: token.length });
        continue;
      }
    }

    const negSingle = token.match(/^(-\d{1,4})$/);
    if (negSingle) {
      const y = Number(negSingle[1]);
      if (isPlausibleYear(y, true)) {
        out.push({ start: y, end: y, raw: token, index: 0, length: token.length });
        continue;
      }
    }

    const parsed = parseDateCore(token, true);
    if (parsed) {
      out.push({ start: parsed.start, end: parsed.end, raw: token, index: 0, length: token.length });
    }
  }
  return out;
}

/** True when any range in `ranges` overlaps `[selStart, selEnd]`. */
export function rangesIntersect(
  ranges: readonly { start: number; end: number }[],
  selStart: number,
  selEnd: number
): boolean {
  const lo = Math.min(selStart, selEnd);
  const hi = Math.max(selStart, selEnd);
  for (const r of ranges) {
    if (r.start <= hi && r.end >= lo) return true;
  }
  return false;
}

export function formatYear(year: number, withUnit = false): string {
  const y = Math.round(year);
  if (y < 0) return withUnit ? `前${Math.abs(y)}年` : `前${Math.abs(y)}`;
  return withUnit ? `${y}年` : `${y}`;
}
