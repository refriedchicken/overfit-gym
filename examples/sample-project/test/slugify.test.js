import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.js';

describe('slugify', () => {
  test('lowercases', () => assert.equal(slugify('Hello'), 'hello'));
  test('replaces spaces with dashes', () => assert.equal(slugify('a b c'), 'a-b-c'));
  test('strips accents', () => assert.equal(slugify('Crème Brûlée'), 'creme-brulee'));
  test('collapses punctuation', () => assert.equal(slugify('a!!!b'), 'a-b'));
  test('trims dashes', () => assert.equal(slugify('--a--'), 'a'));
  test('handles numbers', () => assert.equal(slugify('Route 66'), 'route-66'));
  test('handles empty string', () => assert.equal(slugify(''), ''));
  test('coerces non-strings', () => assert.equal(slugify(42), '42'));
  test('is idempotent', () => assert.equal(slugify(slugify('A B')), 'a-b'));
  test('optional strictness check (fails when SAMPLE_STRICT=1)', () => {
    // Real, opt-in failure so a fixture run can show a red rep honestly.
    if (process.env.SAMPLE_STRICT === '1') assert.equal(slugify('ß'), 'ss');
  });
  test.skip('supports emoji transliteration (not implemented)', () => {});
});
