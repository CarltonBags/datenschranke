/**
 * Derive a regex "shape" from an example value, so a DPO can define a custom
 * number format by typing a sample (e.g. "KD-12345") instead of writing regex.
 * Digit runs → \d{n}; letter runs → a case-appropriate class {n}; spaces → \s;
 * everything else is escaped literally. The result is editable in the UI, so
 * fixed prefixes (e.g. keep "KD" literal) can be tweaked by hand.
 */
const UPPER = /[A-ZÄÖÜ]/;
const LOWER = /[a-zäöüß]/;
const LETTER = /[A-Za-zÄÖÜäöüß]/;
const DIGIT = /[0-9]/;
const ALNUM = /[0-9A-Za-zÄÖÜäöüß]/;

function esc(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function regexFromExample(ex: string): string {
  if (!ex) return "";
  let out = "";
  let i = 0;
  while (i < ex.length) {
    const c = ex[i]!;
    if (DIGIT.test(c)) {
      let n = 0;
      while (i < ex.length && DIGIT.test(ex[i]!)) { n++; i++; }
      out += `\\d{${n}}`;
    } else if (LETTER.test(c)) {
      let n = 0;
      let upper = true;
      let lower = true;
      while (i < ex.length && LETTER.test(ex[i]!)) {
        if (!UPPER.test(ex[i]!)) upper = false;
        if (!LOWER.test(ex[i]!)) lower = false;
        n++;
        i++;
      }
      const cls = upper ? "[A-ZÄÖÜ]" : lower ? "[a-zäöüß]" : "[A-Za-zÄÖÜäöüß]";
      out += `${cls}{${n}}`;
    } else if (c === " ") {
      out += "\\s";
      i++;
    } else {
      out += esc(c);
      i++;
    }
  }
  const startB = ALNUM.test(ex[0]!) ? "\\b" : "";
  const endB = ALNUM.test(ex[ex.length - 1]!) ? "\\b" : "";
  return `${startB}${out}${endB}`;
}

/** Test a draft pattern in-browser (instant preview before saving). Returns the
 *  matched substrings, or null if the regex is invalid. */
export function testPattern(regex: string, sample: string): string[] | null {
  try {
    const re = new RegExp(regex, "gu");
    return sample.match(re) ?? [];
  } catch {
    return null;
  }
}
