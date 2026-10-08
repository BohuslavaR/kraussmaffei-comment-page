/**
 * Moderation worker – runs in its own thread, separate from the page.
 *
 * Message in:   { text }
 * Message out:  { status: 'ok', foundWords }  or  { status: 'error', message }
 *
 * Inappropriate words are detected "in any form". Before matching, the text
 * is normalised so that common ways of hiding a word are still caught:
 *   - letter case ............ "WAR", "War"
 *   - inflected forms ........ "wars", "Putin's", "Russian", "Ukrainians"
 *   - diacritics, full-width . "Wär", "ＷＡＲ"
 *   - invisible characters ... "W" + zero-width space + "ar"
 *   - look-alike characters .. "W4r", "Pu7in", "W" + Cyrillic "a" + "r"
 *   - spaced-out letters ..... "W A R", "P.u.t.i.n"
 *
 * Words are matched as substrings, so the filter is strict on purpose.
 * Innocent words that merely contain a banned one (e.g. "software", "aware")
 * are listed in allowed-words.json and skipped – but only as whole words,
 * so "software" is allowed while "war software" is still blocked.
 *
 * The matching functions are exported only so they can be unit-tested in Node.
 */

/** Word lists, resolved relative to this file. */
const INAPPROPRIATE_WORDS_URL = new URL('../data/inappropriate-words.json', import.meta.url);
const ALLOWED_WORDS_URL = new URL('../data/allowed-words.json', import.meta.url);

// ---------------------------------------------------------------------------
// Matching rules
// ---------------------------------------------------------------------------

/** Characters commonly used instead of Latin letters. */
const LOOKALIKE_CHARACTERS = new Map([
  // Leetspeak
  ['0', 'o'], ['1', 'i'], ['3', 'e'], ['4', 'a'], ['5', 's'], ['7', 't'], ['@', 'a'], ['$', 's'],
  // Cyrillic letters that look exactly like Latin ones (а е о р с у х і ј ѕ ԝ)
  ['\u0430', 'a'], ['\u0435', 'e'], ['\u043E', 'o'], ['\u0440', 'p'], ['\u0441', 'c'],
  ['\u0443', 'y'], ['\u0445', 'x'], ['\u0456', 'i'], ['\u0458', 'j'], ['\u0455', 's'],
  ['\u051D', 'w'],
]);

/** Diacritical marks left over after NFKD normalisation (e.g. the dots of "ä"). */
const COMBINING_MARKS = /\p{M}/gu;

/** Soft hyphen, zero-width spaces/joiners, direction marks, word joiner, BOM. */
const INVISIBLE_CHARACTERS = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;

/** Three or more single letters separated by spaces or punctuation, e.g. "w a r". */
const SPACED_OUT_LETTERS = /(?<!\p{L})\p{L}(?:[\s._*-]+\p{L}(?!\p{L})){2,}/gu;
/** Characters that may separate spaced-out letters. */
const LETTER_SEPARATORS = /[\s._*-]+/g;

/** Final vowels are dropped from longer words, so "Ukraine" also matches "Ukrainian". */
const TRAILING_VOWELS = /[aeiouy]+$/;
/** Shorter words (e.g. "war") are used as they are. */
const MIN_STEM_LENGTH = 4;

/** A run of letters, i.e. one word of the normalised text. */
const WORD = /\p{L}+/gu;

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

self.addEventListener('message', async (event) => {
  try {
    const [inappropriateWords, allowedWords] = await Promise.all([
      loadWordList(INAPPROPRIATE_WORDS_URL),
      loadWordList(ALLOWED_WORDS_URL),
    ]);
    const foundWords = findInappropriateWords(event.data.text, inappropriateWords, allowedWords);
    self.postMessage({ status: 'ok', foundWords });
  } catch (error) {
    self.postMessage({ status: 'error', message: error.message });
  }
});

/**
 * @param {URL} url
 * @returns {Promise<string[]>}
 */
async function loadWordList(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not load ${url.pathname} (HTTP ${response.status}).`);
  }

  const words = await response.json();

  if (!Array.isArray(words) || !words.every((word) => typeof word === 'string')) {
    throw new Error(`${url.pathname} must be a JSON array of strings.`);
  }

  return words;
}

// ---------------------------------------------------------------------------
// Text normalisation and matching
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {string} lower-case text with disguises removed
 */
export function normalizeText(text) {
  const simplified = text
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(INVISIBLE_CHARACTERS, '')
    .toLowerCase();

  return Array.from(simplified, (char) => LOOKALIKE_CHARACTERS.get(char) ?? char)
    .join('')
    .replace(SPACED_OUT_LETTERS, (letters) => letters.replace(LETTER_SEPARATORS, ''));
}

/**
 * @param {string} text comment text
 * @param {string[]} inappropriateWords words that are not allowed
 * @param {string[]} [allowedWords] whole words that are always allowed (exceptions)
 * @returns {string[]} the inappropriate words found in the text (empty if none)
 */
export function findInappropriateWords(text, inappropriateWords, allowedWords = []) {
  const normalizedText = removeAllowedWords(normalizeText(text), allowedWords);
  return inappropriateWords.filter((word) => normalizedText.includes(toStem(word)));
}

/**
 * Blanks out whole words that are on the allowed list, e.g. "software".
 * Each word is compared as a whole, so "softwarewar" is not allowed.
 *
 * @param {string} normalizedText
 * @param {string[]} allowedWords
 * @returns {string}
 */
function removeAllowedWords(normalizedText, allowedWords) {
  const allowed = new Set(allowedWords.map(normalizeText));
  return normalizedText.replace(WORD, (word) => (allowed.has(word) ? ' ' : word));
}

/**
 * @param {string} word
 * @returns {string} e.g. "Ukraine" -> "ukrain", "Russia" -> "russi", "War" -> "war"
 */
function toStem(word) {
  const normalizedWord = normalizeText(word);
  const stem = normalizedWord.replace(TRAILING_VOWELS, '');
  return stem.length >= MIN_STEM_LENGTH ? stem : normalizedWord;
}
