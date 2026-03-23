#!/usr/bin/env node
// test/test-prng.js — PRNG quality and seed independence tests
//
// The LT codec depends critically on a deterministic PRNG: both sender and
// receiver reconstruct the same degree and index set for a given block ID
// by seeding the PRNG with that ID.  These tests verify that:
//
//   1. Determinism: same seed → identical output sequence.
//   2. Mixing quality: sequential seeds (block IDs 0, 1, 2, …) produce
//      uncorrelated first outputs, thanks to splitmix32 pre-mixing.
//      Without this, xorshift32 with sequential seeds would yield nearly
//      identical initial outputs, causing all blocks to have the same
//      degree (typically degree 1) — a real bug we saw before adding the
//      mixing step.
//   3. Uniformity of nextFloat() in [0,1) and nextInt(K) in [0,K).
//   4. The PRNG state never collapses to zero (which would make xorshift
//      output 0 forever, since x ^= x<<k is the identity when x=0).

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
// A PRNG that isn't perfectly deterministic across runs would mean the
// decoder reconstructs different XOR masks than the encoder used, producing
// garbage output.  We verify 1000 consecutive values match for two
// identically-seeded generators.

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
  // With 32-bit outputs, the probability of a single collision is ~2^-32.
  // 100 trials: expected collisions ≈ 0.  Anything above 5 is suspicious.
  assert.ok(same < 5, `Seeds 1 and 2 produced ${same}/100 identical values`);
});

// ── Splitmix Mixing Quality ──────────────────────────────────────────────
// Raw xorshift32 with sequential seeds s and s+1 differs only in the LSBs,
// so the first few outputs are highly correlated.  We apply splitmix32
// (multiply-shift hash) to the seed before initialising xorshift32 state.
//
// Test: generate the first output of 10 000 sequentially-seeded PRNGs
// and bucket the top 4 bits.  If mixing is good, the 16 buckets should
// each get roughly 10000/16 = 625 hits (within ±30%).

console.log('\nSplitmix mixing (sequential seed independence):');

test('Sequential seeds produce uncorrelated first outputs', () => {
  const N = 10000;
  const firstValues = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    const rng = new Fountain.Xorshift32(i + 1);
    firstValues[i] = rng.next();
  }

  const buckets = new Uint32Array(16);
  for (const v of firstValues) {
    buckets[(v >>> 28)]++;     // top 4 bits → bucket index 0–15
  }
  for (let b = 0; b < 16; b++) {
    const expected = N / 16;
    const ratio = buckets[b] / expected;
    assert.ok(ratio > 0.7 && ratio < 1.3,
      `Bucket ${b}: ${buckets[b]} values (expected ~${expected}, ratio ${ratio.toFixed(2)})`);
  }
});

test('Sequential seeds produce different degrees (no all-degree-1 bug)', () => {
  // This was an actual bug before splitmix mixing was added: sequential
  // seeds yielded near-identical first nextFloat() values, so binary search
  // into the CDF always landed on degree 1 — meaning every encoded block
  // was just a copy of a single source block, and the decoder could never
  // XOR-cancel to recover the rest.
  const K = 100;
  const { cdf } = Fountain.computeRobustSoliton(K);
  let degree1Count = 0;
  const N = 1000;

  for (let blockId = 0; blockId < N; blockId++) {
    const rng = new Fountain.Xorshift32(blockId + 1);
    const r = rng.nextFloat();
    // Binary search for degree (same algorithm as sampleDegree)
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) degree1Count++;
  }

  // Under Robust Soliton with c=0.03, δ=0.05, the theoretical degree-1
  // probability is typically 5–15% of blocks.  If mixing is broken we'd
  // see close to 100%.
  const rate = degree1Count / N;
  assert.ok(rate < 0.30,
    `Degree-1 rate ${(rate * 100).toFixed(1)}% is suspiciously high — mixing may be broken`);
  assert.ok(rate > 0.01,
    `Degree-1 rate ${(rate * 100).toFixed(1)}% is suspiciously low`);
});

// ── Uniformity of nextFloat ──────────────────────────────────────────────
// nextFloat divides a 32-bit unsigned integer by 2^32 to get [0, 1).
// If the underlying PRNG is unbiased, the resulting floats should be
// approximately uniform.  We bin 100 000 samples into 10 equal-width
// bins and check that each bin has between 90% and 110% of the expected
// count (i.e. no bin deviates by more than 10%).

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
    const expected = N / 10;  // = 10 000
    const ratio = bins[b] / expected;
    assert.ok(ratio > 0.9 && ratio < 1.1,
      `Bin ${b}: ${bins[b]} (expected ~${expected}, ratio ${ratio.toFixed(3)})`);
  }
});

// ── nextInt bias check ───────────────────────────────────────────────────
// nextInt(K) uses modular reduction: next() % K.  This introduces slight
// bias because 2^32 is not always a multiple of K, but for K ≤ a few
// thousand the bias is negligible (~K/2^32 ≈ 0.00002%).  We verify
// empirically that no value in [0,K) deviates by more than 10% from the
// expected count over 500 000 samples.

console.log('\nnextInt uniformity:');

test('nextInt(K) is roughly uniform for K=100', () => {
  const rng = new Fountain.Xorshift32(7777);
  const K = 100;
  const counts = new Uint32Array(K);
  const N = 500000;
  for (let i = 0; i < N; i++) {
    counts[rng.nextInt(K)]++;
  }
  const expected = N / K;  // = 5 000
  let maxDeviation = 0;
  for (let i = 0; i < K; i++) {
    const dev = Math.abs(counts[i] - expected) / expected;
    if (dev > maxDeviation) maxDeviation = dev;
  }
  assert.ok(maxDeviation < 0.10,
    `Max deviation ${(maxDeviation * 100).toFixed(1)}% exceeds 10%`);
});

// ── Period / non-zero ────────────────────────────────────────────────────
// Xorshift32 has a full period of 2^32 − 1, visiting every nonzero 32-bit
// state exactly once.  The one absorbing state is 0: if state ever becomes
// zero, all three XOR-shift steps leave it at zero forever.  The splitmix
// pre-mixing ensures this can't happen (it maps seed=0 to a nonzero
// state).  We verify both properties over 100 000 steps.

console.log('\nPRNG state properties:');

test('State never becomes zero (would kill the PRNG)', () => {
  const rng = new Fountain.Xorshift32(1);
  for (let i = 0; i < 100000; i++) {
    rng.next();
    assert.ok(rng.state !== 0, `State became zero at step ${i}`);
  }
});

test('Seed=0 is handled (splitmix maps it to nonzero)', () => {
  // Without the splitmix mixing, seed=0 would initialise state=0 and
  // the PRNG would output 0 forever.
  const rng = new Fountain.Xorshift32(0);
  assert.ok(rng.state !== 0, 'State should not be zero after mixing seed=0');
  const v = rng.next();
  assert.ok(v !== 0, 'First output should not be zero');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
