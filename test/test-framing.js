#!/usr/bin/env node
// test/test-framing.js — Frame serialization and forematter tests

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

// ── Frame Encode/Decode ──────────────────────────────────────────────────

console.log('\nFrame encode/decode:');

test('Round-trip: encodeFrame → decodeFrame preserves all fields', () => {
  const sessionId = 0xABCD;
  const K = 150;
  const blockId = 0xDEADBEEF;
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  const encoded = QRFrame.encodeFrame(sessionId, K, blockId, payload);
  assert.ok(typeof encoded === 'string', 'Encoded should be a string');

  const decoded = QRFrame.decodeFrame(encoded);
  assert.strictEqual(decoded.sessionId, sessionId);
  assert.strictEqual(decoded.K, K);
  assert.strictEqual(decoded.blockId, blockId);
  assert.strictEqual(decoded.payload.length, payload.length);
  for (let i = 0; i < payload.length; i++) {
    assert.strictEqual(decoded.payload[i], payload[i]);
  }
});

test('Various payload sizes (0, 1, 350, 680, 1500)', () => {
  for (const size of [0, 1, 350, 680, 1500]) {
    const payload = new Uint8Array(size);
    for (let i = 0; i < size; i++) payload[i] = i & 0xFF;

    const encoded = QRFrame.encodeFrame(1, 10, 42, payload);
    const decoded = QRFrame.decodeFrame(encoded);
    assert.ok(decoded !== null, `Payload size=${size} should decode`);
    assert.strictEqual(decoded.payload.length, size, `Payload size mismatch for size=${size}`);
    for (let i = 0; i < size; i++) {
      assert.strictEqual(decoded.payload[i], payload[i], `Byte mismatch at ${i} for size=${size}`);
    }
  }
});

test('Truncated frame (less than header) returns null', () => {
  // A base64 string that decodes to fewer than 8 bytes
  const short = QRFrame.uint8ToBase64(new Uint8Array([1, 2, 3]));
  assert.strictEqual(QRFrame.decodeFrame(short), null);
});

test('Session ID edge values (0, 1, 0xFFFF)', () => {
  for (const sid of [0, 1, 0xFFFF]) {
    const encoded = QRFrame.encodeFrame(sid, 1, 0, new Uint8Array([0]));
    const decoded = QRFrame.decodeFrame(encoded);
    assert.strictEqual(decoded.sessionId, sid);
  }
});

test('K edge values (1, 0xFFFF)', () => {
  for (const K of [1, 0xFFFF]) {
    const encoded = QRFrame.encodeFrame(1, K, 0, new Uint8Array([0]));
    const decoded = QRFrame.decodeFrame(encoded);
    assert.strictEqual(decoded.K, K);
  }
});

test('Block ID edge values (0, 1, 0xFFFFFFFF)', () => {
  for (const bid of [0, 1, 0xFFFFFFFF]) {
    const encoded = QRFrame.encodeFrame(1, 1, bid, new Uint8Array([0]));
    const decoded = QRFrame.decodeFrame(encoded);
    assert.strictEqual(decoded.blockId, bid);
  }
});

// ── Forematter ───────────────────────────────────────────────────────────

console.log('\nForematter build/parse:');

test('Round-trip: buildForemattedData → parseForemattedData', () => {
  const filename = 'hello.txt';
  const content = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

  const foremattered = QRFrame.buildForemattedData(filename, content);

  // Forematter is: [fileSize:4][nameLen:2][name][content]
  assert.ok(foremattered.length === 4 + 2 + filename.length + content.length);

  const parsed = QRFrame.parseForemattedData(foremattered);
  assert.strictEqual(parsed.filename, filename);
  assert.strictEqual(parsed.content.length, content.length);
  for (let i = 0; i < content.length; i++) {
    assert.strictEqual(parsed.content[i], content[i]);
  }
});

test('Unicode filename', () => {
  const filename = '日本語ファイル.txt';
  const content = new Uint8Array([1, 2, 3]);

  const foremattered = QRFrame.buildForemattedData(filename, content);
  const parsed = QRFrame.parseForemattedData(foremattered);
  assert.strictEqual(parsed.filename, filename);
});

test('Long filename (500 chars)', () => {
  const filename = 'a'.repeat(500) + '.dat';
  const content = new Uint8Array([42]);

  const foremattered = QRFrame.buildForemattedData(filename, content);
  const parsed = QRFrame.parseForemattedData(foremattered);
  assert.strictEqual(parsed.filename, filename);
});

test('Empty filename', () => {
  const filename = '';
  const content = new Uint8Array([1, 2, 3]);

  const foremattered = QRFrame.buildForemattedData(filename, content);
  const parsed = QRFrame.parseForemattedData(foremattered);
  assert.strictEqual(parsed.filename, '');
  assert.strictEqual(parsed.content.length, 3);
});

test('Large file content preserved exactly', () => {
  const filename = 'big.bin';
  const content = new Uint8Array(10000);
  for (let i = 0; i < content.length; i++) content[i] = i & 0xFF;

  const foremattered = QRFrame.buildForemattedData(filename, content);
  const parsed = QRFrame.parseForemattedData(foremattered);
  assert.strictEqual(parsed.content.length, content.length);
  for (let i = 0; i < content.length; i++) {
    assert.strictEqual(parsed.content[i], content[i], `Byte mismatch at ${i}`);
  }
});

// ── End-to-End: Forematter Through LT Codec ──────────────────────────────

console.log('\nEnd-to-end (forematter + LT codec):');

test('File survives full encode → LT → decode → parse pipeline', () => {
  const filename = 'test-photo.jpg';
  const content = new Uint8Array(5000);
  for (let i = 0; i < content.length; i++) content[i] = Math.floor(Math.random() * 256);

  const foremattered = QRFrame.buildForemattedData(filename, content);
  const blockSize = 680;
  const encoder = new Fountain.LTEncoder(foremattered, blockSize);
  const decoder = new Fountain.LTDecoder(encoder.K, blockSize);

  let blocksAdded = 0;
  while (!decoder.complete && blocksAdded < encoder.K * 5) {
    const block = encoder.encode();
    decoder.addBlock(block.blockId, block.payload);
    blocksAdded++;
  }
  assert.ok(decoder.complete);

  const rawData = decoder.getData();
  const parsed = QRFrame.parseForemattedData(rawData);
  assert.strictEqual(parsed.filename, filename);
  assert.strictEqual(parsed.content.length, content.length);
  for (let i = 0; i < content.length; i++) {
    assert.strictEqual(parsed.content[i], content[i], `Content mismatch at byte ${i}`);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
