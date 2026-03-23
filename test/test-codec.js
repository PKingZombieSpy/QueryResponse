#!/usr/bin/env node
// test/test-codec.js — LT fountain codec encoding/decoding tests
//
// These tests exercise the full LT encode → decode pipeline at various
// file sizes and block sizes.  The key properties we verify:
//
//   1. Round-trip fidelity: encode arbitrary data, feed encoded blocks to
//      the decoder, and confirm byte-for-byte reconstruction.
//   2. Overhead: the decoder should finish within a small multiple of K
//      blocks (the theoretical minimum is K; with Robust Soliton, typical
//      overhead is 1.1–1.25×, though small K can be higher).
//   3. Robustness: duplicates are ignored, out-of-order delivery works,
//      and edge cases (K=1, K=2) decode correctly.

'use strict';

require('../pages/js/fountain.js');
require('../pages/js/qrframe.js');

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

function randomBytes(n) {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

// ── Encode/Decode Round-Trip ─────────────────────────────────────────────
// For each test case we:
//   1. Create an LTEncoder over random data with a given block size.
//   2. Feed encoded blocks to an LTDecoder until it reports completion
//      (or we hit 5× K blocks as a safety limit — if decoding hasn't
//      converged by then, something is wrong).
//   3. Compare the decoded output (ignoring zero-padding in the last
//      block) against the original data.

console.log('\nCodec round-trip tests:');

function roundTrip(dataSize, blockSize, label) {
  test(`${label} (${dataSize}B, blockSize=${blockSize})`, () => {
    const data = randomBytes(dataSize);
    const encoder = new Fountain.LTEncoder(data, blockSize);
    const decoder = new Fountain.LTDecoder(encoder.K, blockSize);

    let blocksAdded = 0;
    const maxBlocks = encoder.K * 5;
    while (!decoder.complete && blocksAdded < maxBlocks) {
      const block = encoder.encode();
      decoder.addBlock(block.blockId, block.payload);
      blocksAdded++;
    }

    assert.ok(decoder.complete, `Failed to decode after ${maxBlocks} blocks (K=${encoder.K})`);

    const result = decoder.getData();
    for (let i = 0; i < dataSize; i++) {
      assert.strictEqual(result[i], data[i], `Mismatch at byte ${i}`);
    }
  });
}

roundTrip(1, 64, 'Tiny file (1 byte)');
roundTrip(63, 64, 'Just under one block');
roundTrip(64, 64, 'Exactly one block');
roundTrip(65, 64, 'Just over one block');
roundTrip(500, 128, 'Small file');
roundTrip(1000, 256, 'Medium file');
roundTrip(5000, 680, 'Typical file (default block size)');
roundTrip(10000, 350, 'Small QR blocks');
roundTrip(10000, 1500, 'Large QR blocks');
roundTrip(50000, 680, '50KB file');

// ── Overhead Ratio ───────────────────────────────────────────────────────
// The overhead ratio = (blocks needed to decode) / K.  The theoretical
// minimum is 1.0× (every block happens to be useful).  In practice,
// Robust Soliton with our parameters (c=0.03, δ=0.05) typically needs
// 1.1–1.25× for large K.  Small K (5–10 blocks) may need up to 2×
// because the soliton distribution has less room to spread.
//
// We run 5 independent trials and check the median, which smooths out
// the randomness inherent in which degrees the PRNG samples.

console.log('\nOverhead ratio tests:');

function overheadTest(dataSize, blockSize, maxRatio, label) {
  test(`${label}: overhead ≤ ${maxRatio}×`, () => {
    const trials = 5;
    const ratios = [];

    for (let t = 0; t < trials; t++) {
      const data = randomBytes(dataSize);
      const encoder = new Fountain.LTEncoder(data, blockSize);
      const decoder = new Fountain.LTDecoder(encoder.K, blockSize);

      let blocksAdded = 0;
      while (!decoder.complete) {
        const block = encoder.encode();
        decoder.addBlock(block.blockId, block.payload);
        blocksAdded++;
      }
      ratios.push(blocksAdded / encoder.K);
    }

    ratios.sort((a, b) => a - b);
    const median = ratios[Math.floor(trials / 2)];
    assert.ok(median <= maxRatio,
      `Median overhead ${median.toFixed(2)}× exceeds ${maxRatio}× (ratios: ${ratios.map(r => r.toFixed(2)).join(', ')})`);
  });
}

overheadTest(5000, 680, 2.0, '5KB/680B');
overheadTest(10000, 680, 1.8, '10KB/680B');
overheadTest(50000, 680, 1.5, '50KB/680B');

// ── Edge Cases ───────────────────────────────────────────────────────────

console.log('\nEdge case tests:');

test('Duplicate block IDs are safely ignored', () => {
  // The decoder tracks seen block IDs in a Set.  Re-feeding the same
  // block ID should return false and not corrupt internal state.
  const data = randomBytes(2000);
  const encoder = new Fountain.LTEncoder(data, 256);
  const decoder = new Fountain.LTDecoder(encoder.K, 256);

  for (let i = 0; i < encoder.K * 3 && !decoder.complete; i++) {
    const block = encoder.encode();
    const first = decoder.addBlock(block.blockId, block.payload);
    if (first && decoder.complete) break;
    const dup = decoder.addBlock(block.blockId, block.payload);
    assert.strictEqual(dup, false, 'Duplicate should return false');
  }
});

test('Out-of-order blocks still decode', () => {
  // Fountain codes are order-agnostic by design: the receiver can start
  // scanning at any point in the animation and capture frames in any
  // order.  We generate 3× K blocks, shuffle them, and verify decoding.
  const data = randomBytes(3000);
  const encoder = new Fountain.LTEncoder(data, 256);
  const decoder = new Fountain.LTDecoder(encoder.K, 256);

  const blocks = [];
  for (let i = 0; i < encoder.K * 3; i++) {
    blocks.push(encoder.encode());
  }
  // Fisher-Yates shuffle
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }

  for (const block of blocks) {
    if (decoder.complete) break;
    decoder.addBlock(block.blockId, block.payload);
  }

  assert.ok(decoder.complete, 'Should decode even with shuffled block order');
  const result = decoder.getData();
  for (let i = 0; i < data.length; i++) {
    assert.strictEqual(result[i], data[i], `Mismatch at byte ${i}`);
  }
});

test('K=1 (single block) decodes immediately', () => {
  // With K=1, every encoded block has degree 1 (the only possible
  // degree), so the very first block should complete decoding.
  const data = randomBytes(50);
  const encoder = new Fountain.LTEncoder(data, 256);
  assert.strictEqual(encoder.K, 1);

  const decoder = new Fountain.LTDecoder(1, 256);
  const block = encoder.encode();
  const done = decoder.addBlock(block.blockId, block.payload);
  assert.ok(done, 'Single-block file should decode in one block');

  const result = decoder.getData();
  for (let i = 0; i < data.length; i++) {
    assert.strictEqual(result[i], data[i]);
  }
});

test('K=2 (two blocks) decodes correctly', () => {
  // K=2 is the smallest non-trivial case.  Degree can be 1 or 2:
  // - degree 1 → a copy of source block 0 or 1
  // - degree 2 → XOR of both source blocks
  // We need at least one degree-1 for each source block, or one degree-1
  // plus one degree-2, to decode.  20 attempts is generous.
  const data = randomBytes(300);
  const encoder = new Fountain.LTEncoder(data, 200);
  assert.strictEqual(encoder.K, 2);

  const decoder = new Fountain.LTDecoder(2, 200);
  let done = false;
  for (let i = 0; i < 20 && !done; i++) {
    const block = encoder.encode();
    done = decoder.addBlock(block.blockId, block.payload);
  }
  assert.ok(done, 'Two-block file should decode');
  const result = decoder.getData();
  for (let i = 0; i < data.length; i++) {
    assert.strictEqual(result[i], data[i]);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
