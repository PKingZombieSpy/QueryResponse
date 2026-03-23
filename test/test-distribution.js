#!/usr/bin/env node
// test/test-distribution.js — Verify Robust Soliton degree distribution
//
// The Robust Soliton Distribution (Luby 2002) is the probability mass
// function over block degrees 1…K used by the LT codec.  It combines:
//
//   ρ(d) — the Ideal Soliton:
//     ρ(1) = 1/K
//     ρ(d) = 1/(d(d−1))   for d = 2…K
//
//   τ(d) — the "robust" spike:
//     τ(d) = S/(dK)                  for d = 1…⌊K/S⌋ − 1
//     τ(⌊K/S⌋) = S·ln(S/δ) / K
//     τ(d) = 0                       for d > ⌊K/S⌋
//
// where S = c · ln(K/δ) · √K, with tuning parameters c and δ.
// The final PMF is μ(d) = (ρ(d) + τ(d)) / Z, with Z = Σ (ρ+τ).
//
// The spike at d = ⌊K/S⌋ ensures there are enough degree-1 blocks to
// start the peeling decoder, while the 1/(d(d−1)) tail supplies the
// higher-degree redundancy needed for full reconstruction.
//
// These tests verify:
//   1. PMF sums to 1 and CDF is monotonically increasing (basic validity).
//   2. Empirical sampling matches the theoretical PMF via a chi-squared
//      goodness-of-fit test.
//   3. Degree-1 blocks appear at the rate predicted by the PMF.

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
// These are sanity checks on the computed PMF and CDF arrays:
// any error in the soliton computation would be caught here before we
// need the heavier statistical tests.

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
  // With only one source block, every encoded block must have degree 1
  // (i.e., it IS the source block).
  const { pmf } = Fountain.computeRobustSoliton(1);
  assert.strictEqual(pmf.length, 1);
  assert.ok(Math.abs(pmf[0] - 1.0) < 1e-10);
});

// ── Empirical Sampling vs Theoretical PMF ────────────────────────────────
//
// Pearson's chi-squared goodness-of-fit test:
//
// We draw N samples from the distribution (using the same PRNG + CDF
// binary search that the codec uses) and build a histogram.  For each
// degree d with expected count E_d = pmf[d] × N ≥ 5 (the standard
// minimum to make the chi-squared approximation valid), we compute:
//
//   χ² = Σ_d  (O_d − E_d)² / E_d
//
// where O_d is the observed count.  Under H₀ (samples match the PMF),
// χ² follows a chi-squared distribution with df = binsUsed − 1 degrees
// of freedom.  We reject if χ² exceeds a critical value.
//
// For the critical value, we use 3 × binsUsed as a rough upper bound
// for the p = 0.001 threshold.  For typical df ≈ 5–15, the exact
// p = 0.001 critical values are 15.1–30.6, so 3 × df is conservative
// (i.e. the test is unlikely to produce false positives).
//
// We skip bins with E_d < 5 because the chi-squared approximation
// breaks down for small expected counts (the statistic no longer
// approximately follows χ² in that regime).

console.log('\nEmpirical sampling vs theoretical PMF:');

function chiSquaredTest(K, numSamples) {
  const { cdf, pmf } = Fountain.computeRobustSoliton(K);

  // Sample degrees using sequential seeds (as the codec does).
  // Each seed gets one PRNG → one nextFloat() → one binary-search → one degree.
  const histogram = new Float64Array(K);
  for (let seed = 1; seed <= numSamples; seed++) {
    const rng = new Fountain.Xorshift32(seed);
    const r = rng.nextFloat();
    // Binary search for the first CDF entry ≥ r (same as sampleDegree)
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const degree = lo + 1;   // degrees are 1-indexed
    histogram[degree - 1]++;
  }

  // Compute Pearson's chi-squared statistic,
  // skipping degrees whose expected count is below 5.
  let chiSq = 0;
  let binsUsed = 0;
  for (let i = 0; i < K; i++) {
    const expected = pmf[i] * numSamples;
    if (expected < 5) continue;
    chiSq += Math.pow(histogram[i] - expected, 2) / expected;
    binsUsed++;
  }

  return { chiSq, binsUsed, histogram };
}

test('K=50: sampled degrees match Robust Soliton (chi-squared)', () => {
  const K = 50;
  const N = 100000;
  const { chiSq, binsUsed } = chiSquaredTest(K, N);
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
// Degree-1 blocks are the "entry point" for the peeling decoder: each one
// gives a source block directly, which can then be XOR'd out of buffered
// higher-degree blocks.  If too few degree-1 blocks appear, decoding
// stalls; if too many appear, redundancy is wasted.  We check that the
// empirical degree-1 rate is within 5% (relative) of the theoretical
// value from the PMF.

console.log('\nDegree-1 frequency (critical for LT decoding):');

test('Degree-1 blocks appear at expected rate (K=200)', () => {
  const K = 200;
  const { pmf } = Fountain.computeRobustSoliton(K);
  const expectedP1 = pmf[0];    // pmf[0] is the probability of degree 1

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
    if (lo === 0) count1++;  // lo=0 means degree=1
  }

  const observedP1 = count1 / N;
  const relError = Math.abs(observedP1 - expectedP1) / expectedP1;
  assert.ok(relError < 0.05,
    `Degree-1 rate: observed ${(observedP1 * 100).toFixed(2)}% vs expected ${(expectedP1 * 100).toFixed(2)}% (${(relError * 100).toFixed(1)}% off)`);
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
