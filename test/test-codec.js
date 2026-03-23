#!/usr/bin/env node
// test/test-codec.js — LT fountain codec encoding/decoding tests

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

console.log('\nCodec round-trip tests:');

function roundTrip(dataSize, blockSize, label) {
  test(`${label} (${dataSize}B, blockSize=${blockSize})`, () => {
    const data = randomBytes(dataSize);
    const encoder = new Fountain.LTEncoder(data, blockSize);
    const decoder = new Fountain.LTDecoder(encoder.K, blockSize);

    let blocksAdded = 0;
    const maxBlocks = encoder.K * 5; // generous limit
    while (!decoder.complete && blocksAdded < maxBlocks) {
      const block = encoder.encode();
      decoder.addBlock(block.blockId, block.payload);
      blocksAdded++;
    }

    assert.ok(decoder.complete, `Failed to decode after ${maxBlocks} blocks (K=${encoder.K})`);

    const result = decoder.getData();
    // Compare only the original data length (ignore zero padding)
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

console.log('\nOverhead ratio tests:');

function overheadTest(dataSize, blockSize, maxRatio, label) {
  test(`${label}: overhead ≤ ${maxRatio}×`, () => {
    // Run several trials and take the median overhead
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

// ── Duplicate Block IDs ──────────────────────────────────────────────────

console.log('\nEdge case tests:');

test('Duplicate block IDs are safely ignored', () => {
  const data = randomBytes(2000);
  const encoder = new Fountain.LTEncoder(data, 256);
  const decoder = new Fountain.LTDecoder(encoder.K, 256);

  // Generate some blocks, feed each one, then immediately feed again
  for (let i = 0; i < encoder.K * 3 && !decoder.complete; i++) {
    const block = encoder.encode();
    const first = decoder.addBlock(block.blockId, block.payload);
    if (first && decoder.complete) break; // decoding finished on this block
    // Feed same block again — should return false (already seen)
    const dup = decoder.addBlock(block.blockId, block.payload);
    assert.strictEqual(dup, false, 'Duplicate should return false');
  }
});

test('Out-of-order blocks still decode', () => {
  const data = randomBytes(3000);
  const encoder = new Fountain.LTEncoder(data, 256);
  const decoder = new Fountain.LTDecoder(encoder.K, 256);

  // Generate many blocks, shuffle, then feed
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
