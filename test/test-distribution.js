#!/usr/bin/env node
// test/test-distribution.js — Verify Robust Soliton degree distribution

'use strict';

require('../pages/js/fountain.js');

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ── Robust Soliton Distribution Properties ───────────────────────────────

console.log('\nRobust Soliton distribution properties:');

test('PMF sums to 1.0', () => {
  for (const K of [10, 50, 200, 1000]) {
    const { pmf } = Fountain.computeRobustSoliton(K);
    const sum = pmf.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-10, `K=${K}: PMF sum = ${sum}`);
  }
});

test('CDF is monotonically increasing and ends at 1.0', () => {
  for (const K of [10, 100, 500]) {
    const { cdf } = Fountain.computeRobustSoliton(K);
    for (let i = 1; i < cdf.length; i++) {
      assert.ok(cdf[i] >= cdf[i - 1], `K=${K}: CDF not monotonic at index ${i}`);
    }
    assert.ok(Math.abs(cdf[cdf.length - 1] - 1.0) < 1e-10, `K=${K}: CDF doesn't end at 1.0`);
  }
});

test('All PMF values are non-negative', () => {
  for (const K of [1, 5, 50, 500]) {
    const { pmf } = Fountain.computeRobustSoliton(K);
    for (let i = 0; i < pmf.length; i++) {
      assert.ok(pmf[i] >= 0, `K=${K}: negative PMF at degree ${i + 1}`);
    }
  }
});

test('K=1 produces trivial distribution (degree 1 only)', () => {
  const { pmf } = Fountain.computeRobustSoliton(1);
  assert.strictEqual(pmf.length, 1);
  assert.ok(Math.abs(pmf[0] - 1.0) < 1e-10);
});

// ── Empirical Sampling vs Theoretical PMF ────────────────────────────────

console.log('\nEmpirical sampling vs theoretical PMF:');

function chiSquaredTest(K, numSamples) {
  const { cdf, pmf } = Fountain.computeRobustSoliton(K);

  // Sample degrees using sequential seeds (as the codec does)
  const histogram = new Float64Array(K);
  for (let seed = 1; seed <= numSamples; seed++) {
    const rng = new Fountain.Xorshift32(seed);
    const r = rng.nextFloat();
    // Binary search (same as sampleDegree)
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const degree = lo + 1;
    histogram[degree - 1]++;
  }

  // Chi-squared goodness-of-fit
  let chiSq = 0;
  let binsUsed = 0;
  for (let i = 0; i < K; i++) {
    const expected = pmf[i] * numSamples;
    if (expected < 5) continue; // skip sparse bins (standard chi-sq rule)
    chiSq += Math.pow(histogram[i] - expected, 2) / expected;
    binsUsed++;
  }

  return { chiSq, binsUsed, histogram };
}

test('K=50: sampled degrees match Robust Soliton (chi-squared)', () => {
  const K = 50;
  const N = 100000;
  const { chiSq, binsUsed } = chiSquaredTest(K, N);
  // df = binsUsed - 1. For p=0.001, critical value is roughly 3× df.
  const criticalValue = binsUsed * 3;
  assert.ok(chiSq < criticalValue,
    `Chi-squared ${chiSq.toFixed(1)} exceeds critical value ${criticalValue} (${binsUsed} bins)`);
});

test('K=200: sampled degrees match Robust Soliton (chi-squared)', () => {
  const K = 200;
  const N = 200000;
  const { chiSq, binsUsed } = chiSquaredTest(K, N);
  const criticalValue = binsUsed * 3;
  assert.ok(chiSq < criticalValue,
    `Chi-squared ${chiSq.toFixed(1)} exceeds critical value ${criticalValue} (${binsUsed} bins)`);
});

test('K=1000: sampled degrees match Robust Soliton (chi-squared)', () => {
  const K = 1000;
  const N = 500000;
  const { chiSq, binsUsed } = chiSquaredTest(K, N);
  const criticalValue = binsUsed * 3;
  assert.ok(chiSq < criticalValue,
    `Chi-squared ${chiSq.toFixed(1)} exceeds critical value ${criticalValue} (${binsUsed} bins)`);
});

// ── Degree-1 Frequency ──────────────────────────────────────────────────

console.log('\nDegree-1 frequency (critical for LT decoding):');

test('Degree-1 blocks appear at expected rate (K=200)', () => {
  const K = 200;
  const { pmf } = Fountain.computeRobustSoliton(K);
  const expectedP1 = pmf[0];

  const N = 100000;
  let count1 = 0;
  const { cdf } = Fountain.computeRobustSoliton(K);
  for (let seed = 1; seed <= N; seed++) {
    const rng = new Fountain.Xorshift32(seed);
    const r = rng.nextFloat();
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) count1++;
  }

  const observedP1 = count1 / N;
  const relError = Math.abs(observedP1 - expectedP1) / expectedP1;
  assert.ok(relError < 0.05,
    `Degree-1 rate: observed ${(observedP1 * 100).toFixed(2)}% vs expected ${(expectedP1 * 100).toFixed(2)}% (${(relError * 100).toFixed(1)}% off)`);
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
