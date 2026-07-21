/**
 * Hate-speech / slur redaction for public names and messages.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │  THE ONE THING YOU EDIT IS `HATE_TERMS` BELOW.                          │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Scope is deliberate: this list is ONLY for slurs and hate speech. Ordinary
 * profanity / swear words are allowed through by design — do not add them here.
 *
 * When a listed term appears as a whole word (or phrase) in a name or message,
 * every character of the matched word is replaced with █ so it renders as
 * redacted text. Matching:
 *   - is case-insensitive;
 *   - sees through common obfuscation — accents (é→e), leetspeak (@/0/1/3/4/5/7
 *     and $/|/!), and letter-stretching ("sluuur" → "slur");
 *   - is whole-word only, so innocent words that merely *contain* a listed
 *     fragment are left alone (the classic "Scunthorpe problem").
 *
 * Redaction runs on the server before a message is stored, so the raw term is
 * never persisted or exposed through the public feed / API.
 */

const REDACTION_CHAR = "█";

/**
 * Curated slur / hate-speech list — the filter's control surface.
 *
 * Rules for entries:
 *   - lowercase, no surrounding punctuation;
 *   - one term per line; phrases (with spaces) are matched as a word sequence;
 *   - obfuscation variants are handled automatically — add the plain spelling
 *     only (e.g. "n1gg3r" is caught by the "nigger" entry).
 *
 * Keep this focused on slurs and hate speech. This is intentionally a starter
 * set — extend it to fit your community's needs.
 */
export const HATE_TERMS: string[] = [
  // Racial / ethnic slurs
  "nigger",
  "nigga",
  "chink",
  "gook",
  "spic",
  "beaner",
  "wetback",
  "kike",
  "coon",
  "wop",
  "jigaboo",
  "zipperhead",
  "sandnigger",
  "raghead",
  "towelhead",
  "kaffir",
  "paki",
  "porch monkey",
  // Homophobic / transphobic slurs
  "faggot",
  "fag",
  "dyke",
  "tranny",
  "shemale",
  // Ableist slurs
  "retard",
  "retarded",
  // Hate ideology
  "white power",
  "sig heil",
  "sieg heil",
  "heil hitler",
  "nazi",
];

// Single characters mapped from common leetspeak / homoglyph substitutions.
// Applied during normalization so "@" reads as "a", "$" as "s", etc.
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "|": "i",
  "!": "i",
};

/**
 * Fold a single raw word to its comparison form: lowercase, accents stripped,
 * leetspeak resolved, everything non-alphabetic dropped, and repeated letters
 * collapsed ("sluuur" → "slur"). Applied identically to list terms and to input
 * words, so the two only need to agree in this canonical space.
 */
function normalizeWord(raw: string): string {
  const lowered = raw.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""); // strip combining accent marks
  let out = "";
  for (const ch of lowered) {
    if (ch >= "a" && ch <= "z") out += ch;
    else if (LEET[ch]) out += LEET[ch];
    // anything else (apostrophes, punctuation, spaces) is dropped
  }
  return out.replace(/(.)\1+/g, "$1"); // collapse runs of the same letter
}

// Precompute the normalized term structures once at module load.
const SINGLE_TERMS = new Set<string>();
const PHRASE_TERMS: string[][] = [];
for (const term of HATE_TERMS) {
  const words = term.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (words.length === 1) SINGLE_TERMS.add(words[0]);
  else if (words.length > 1) PHRASE_TERMS.push(words);
}

// A "word" for matching: a run of letters, digits, or the leet symbols/marks
// that can appear mid-word. Sentence punctuation and spaces separate words.
const WORD_RE = /[\p{L}\p{N}@$'’]+/gu;

/**
 * Replace any slur / hate-speech words in `text` with █ blocks, preserving the
 * length and surrounding formatting. Returns the input unchanged when nothing
 * matches (including empty input).
 */
export function redact(text: string): string {
  if (!text) return text;

  const tokens: { start: number; end: number; norm: string }[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    tokens.push({
      start,
      end: start + m[0].length,
      norm: normalizeWord(m[0]),
    });
  }
  if (tokens.length === 0) return text;

  const flagged = new Array<boolean>(tokens.length).fill(false);

  // Single-word terms.
  tokens.forEach((t, i) => {
    if (t.norm && SINGLE_TERMS.has(t.norm)) flagged[i] = true;
  });

  // Multi-word phrases: consecutive word tokens whose normalized forms match
  // the phrase in order (intervening punctuation/spacing is irrelevant).
  for (const phrase of PHRASE_TERMS) {
    for (let i = 0; i + phrase.length <= tokens.length; i++) {
      let hit = true;
      for (let j = 0; j < phrase.length; j++) {
        if (tokens[i + j].norm !== phrase[j]) {
          hit = false;
          break;
        }
      }
      if (hit) for (let j = 0; j < phrase.length; j++) flagged[i + j] = true;
    }
  }

  if (!flagged.some(Boolean)) return text;

  // Rebuild, boxing out each flagged span and leaving everything else intact.
  let out = "";
  let cursor = 0;
  tokens.forEach((t, i) => {
    if (!flagged[i]) return;
    out += text.slice(cursor, t.start);
    out += REDACTION_CHAR.repeat(t.end - t.start);
    cursor = t.end;
  });
  out += text.slice(cursor);
  return out;
}
