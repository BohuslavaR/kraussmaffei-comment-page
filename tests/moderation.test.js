/**
 * Unit tests for the word matching in js/moderation.worker.js.
 * Run with: node --test   (Node 18+, no dependencies)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The worker registers a message listener on `self`, which does not exist in Node.
globalThis.self = { addEventListener() {}, postMessage() {} };
const { findInappropriateWords, normalizeText } = await import('../js/moderation.worker.js');

/** Same words as data/inappropriate-words.json. */
const WORDS = ['Putin', 'Ukraine', 'Russia', 'War'];

describe('findInappropriateWords', () => {
  it('allows a clean comment', () => {
    assert.deepEqual(findInappropriateWords('Nice page, thank you!', WORDS), []);
  });

  it('ignores letter case', () => {
    assert.deepEqual(findInappropriateWords('WAR', WORDS), ['War']);
    assert.deepEqual(findInappropriateWords('pUtIn', WORDS), ['Putin']);
  });

  it('finds inflected and derived forms', () => {
    assert.deepEqual(findInappropriateWords('Two wars', WORDS), ['War']);
    assert.deepEqual(findInappropriateWords("Putin's speech", WORDS), ['Putin']);
    assert.deepEqual(findInappropriateWords('Russian and Ukrainian people', WORDS), ['Ukraine', 'Russia']);
  });

  it('returns every word that was found', () => {
    assert.deepEqual(findInappropriateWords('Putin, Russia, Ukraine, war', WORDS), WORDS);
  });

  it('sees through diacritics and full-width letters', () => {
    assert.deepEqual(findInappropriateWords('Wär', WORDS), ['War']);
    assert.deepEqual(findInappropriateWords('ＷＡＲ', WORDS), ['War']);
  });

  it('sees through invisible characters', () => {
    assert.deepEqual(findInappropriateWords('W\u200Bar', WORDS), ['War']);
    assert.deepEqual(findInappropriateWords('Pu\u00ADtin', WORDS), ['Putin']);
  });

  it('sees through look-alike characters', () => {
    assert.deepEqual(findInappropriateWords('W4r', WORDS), ['War']);
    assert.deepEqual(findInappropriateWords('Pu7in', WORDS), ['Putin']);
    assert.deepEqual(findInappropriateWords('W\u0430r', WORDS), ['War']); // Cyrillic "a"
  });

  it('sees through spaced-out letters', () => {
    assert.deepEqual(findInappropriateWords('W A R', WORDS), ['War']);
    assert.deepEqual(findInappropriateWords('P.u.t.i.n', WORDS), ['Putin']);
    assert.deepEqual(findInappropriateWords('u-k-r-a-i-n-e', WORDS), ['Ukraine']);
  });

  it('does not join regular words together', () => {
    assert.deepEqual(findInappropriateWords('a slow arrow', WORDS), []);
    assert.deepEqual(findInappropriateWords('a new art', WORDS), []);
  });
});

describe('allowed words (exceptions)', () => {
  const ALLOWED = ['software', 'aware', 'warning'];

  it('allows innocent words that contain a banned one', () => {
    assert.deepEqual(findInappropriateWords('Our software is great', WORDS, ALLOWED), []);
    assert.deepEqual(findInappropriateWords('I am AWARE of the warning', WORDS, ALLOWED), []);
  });

  it('still blocks a banned word next to an allowed one', () => {
    assert.deepEqual(findInappropriateWords('war software', WORDS, ALLOWED), ['War']);
  });

  it('allows only whole words', () => {
    assert.deepEqual(findInappropriateWords('softwarewar', WORDS, ALLOWED), ['War']);
    assert.deepEqual(findInappropriateWords('unawareness', WORDS, ALLOWED), ['War']);
  });

  it('blocks everything without an allowed list', () => {
    assert.deepEqual(findInappropriateWords('software', WORDS), ['War']);
  });
});

describe('normalizeText', () => {
  it('lower-cases and removes disguises', () => {
    assert.equal(normalizeText('\uFF28\u00E9llo W A\u200B R'), 'hello war');
  });
});
