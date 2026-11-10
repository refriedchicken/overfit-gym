import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../../src/slugify.js';

describe('slug pipeline (integration)', () => {
  test('builds a URL path from a title', () => {
    const title = 'Overfit Gym: Leg Day';
    assert.equal(`/posts/${slugify(title)}`, '/posts/overfit-gym-leg-day');
  });
  test('round-trips a batch of titles', async () => {
    const titles = ['One', 'Two Words', 'Three  Spaced  Words'];
    const slugs = await Promise.all(titles.map(async (t) => slugify(t)));
    assert.deepEqual(slugs, ['one', 'two-words', 'three-spaced-words']);
  });
});
