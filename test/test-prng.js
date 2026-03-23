#!/usr/bin/env node
// test/test-prng.js — PRNG quality and seed independence tests

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

// ── Determinism ──────────────────────────────────────────────────────────

console.log('\nPRNG determinism:');

test('Same seed produces identical sequence', () => {
  const rng1 = new Fountain.Xorshift32(42);
  const rng2 = new Fountain.Xorshift32(42);
  for (let i = 0; i < 1000; i++) {
    assert.strictEqual(rng1.next(), rng2.next(), `Diverged at step ${i}`);
  }
});

test('Different seeds produce different sequences', () => {
  const rng1 = new Fountain.Xorshift32(1);
  const rng2 = new Fountain.Xorshift32(2);
  let same = 0;
  for (let i = 0; i < 100; i++) {
    if (rng1.next() === rng2.next()) same++;
  }
  assert.ok(same < 5, `Seeds 1 and 2 produced ${same}/100 identical values`);
});

// ── Splitmix Mixing Quality ──────────────────────────────────────────────

console.log('\nSplitmix mixing (sequential seed independence):');

test('Sequential seeds produce uncorrelated first outputs', () => {
  // The whole point of the splitmix mixing: block IDs 0,1,2,...
  // should not produce correlated first values.
  const N = 10000;
  const firstValues = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    const rng = new Fountain.Xorshift32(i + 1);
    firstValues[i] = rng.next();
  }

  // Check: first outputs should spread across the 32-bit range.
  // Divide into 16 buckets, expect roughly N/16 = 625 in each.
  const buckets = new Uint32Array(16);
  for (const v of firstValues) {
    buckets[(v >>> 28)]++;
  }
  for (let b = 0; b < 16; b++) {
    const expected = N / 16;
    const ratio = buckets[b] / expected;
    assert.ok(ratio > 0.7 && ratio < 1.3,
      `Bucket ${b}: ${buckets[b]} values (expected ~${expected}, ratio ${ratio.toFixed(2)})`);
  }
});

test('Sequential seeds produce different degrees (no all-degree-1 bug)', () => {
  // This was an actual bug before splitmix mixing was added.
  const K = 100;
  const { cdf } = Fountain.computeRobustSoliton(K);
  let degree1Count = 0;
  const N = 1000;

  for (let blockId = 0; blockId < N; blockId++) {
    const rng = new Fountain.Xorshift32(blockId + 1);
    const r = rng.nextFloat();
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) degree1Count++;
  }

  // Expected degree-1 rate is typically 5–15% for Robust Soliton.
  // If mixing is broken, we'd see ~100% degree-1.
  const rate = degree1Count / N;
  assert.ok(rate < 0.30,
    `Degree-1 rate ${(rate * 100).toFixed(1)}% is suspiciously high — mixing may be broken`);
  assert.ok(rate > 0.01,
    `Degree-1 rate ${(rate * 100).toFixed(1)}% is suspiciously low`);
});

// ── Uniformity of nextFloat ──────────────────────────────────────────────

console.log('\nnextFloat uniformity:');

test('nextFloat values are in [0, 1)', () => {
  const rng = new Fountain.Xorshift32(12345);
  for (let i = 0; i < 100000; i++) {
    const f = rng.nextFloat();
    assert.ok(f >= 0 && f < 1, `Out of range: ${f}`);
  }
});

test('nextFloat is roughly uniform across 10 bins', () => {
  const rng = new Fountain.Xorshift32(99999);
  const bins = new Uint32Array(10);
  const N = 100000;
  for (let i = 0; i < N; i++) {
    const bin = Math.floor(rng.nextFloat() * 10);
    bins[Math.min(bin, 9)]++;
  }
  for (let b = 0; b < 10; b++) {
    const expected = N / 10;
    const ratio = bins[b] / expected;
    assert.ok(ratio > 0.9 && ratio < 1.1,
      `Bin ${b}: ${bins[b]} (expected ~${expected}, ratio ${ratio.toFixed(3)})`);
  }
});

// ── nextInt bias check ───────────────────────────────────────────────────

console.log('\nnextInt uniformity:');

test('nextInt(K) is roughly uniform for K=100', () => {
  const rng = new Fountain.Xorshift32(7777);
  const K = 100;
  const counts = new Uint32Array(K);
  const N = 500000;
  for (let i = 0; i < N; i++) {
    counts[rng.nextInt(K)]++;
  }
  const expected = N / K;
  let maxDeviation = 0;
  for (let i = 0; i < K; i++) {
    const dev = Math.abs(counts[i] - expected) / expected;
    if (dev > maxDeviation) maxDeviation = dev;
  }
  assert.ok(maxDeviation < 0.10,
    `Max deviation ${(maxDeviation * 100).toFixed(1)}% exceeds 10%`);
});

// ── Period / non-zero ────────────────────────────────────────────────────

console.log('\nPRNG state properties:');

test('State never becomes zero (would kill the PRNG)', () => {
  const rng = new Fountain.Xorshift32(1);
  for (let i = 0; i < 100000; i++) {
    rng.next();
    assert.ok(rng.state !== 0, `State became zero at step ${i}`);
  }
});

test('Seed=0 is handled (splitmix maps it to nonzero)', () => {
  const rng = new Fountain.Xorshift32(0);
  assert.ok(rng.state !== 0, 'State should not be zero after mixing seed=0');
  const v = rng.next();
  assert.ok(v !== 0, 'First output should not be zero');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
