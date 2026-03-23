#!/usr/bin/env node
// test/test-framing.js — Frame serialization, forematter, and base45 tests
//
// The QR frame wire format is:
//   [sessionId:2][K:2][blockId:4][payload:blockSize]   (8-byte header)
//
// Before chunking, file data is wrapped in a "forematter":
//   [fileSize:4][nameLen:2][filename:nameLen][content:fileSize]
//
// Frames are base45-encoded (RFC 9285) before being placed in QR codes.
// Base45 maps every pair of bytes to 3 characters drawn from the QR
// alphanumeric charset (0-9 A-Z SP $%*+-./:).  QR alphanumeric mode
// encodes each character pair in 11 bits, so the encoding overhead vs
// raw binary is only ~3% — far less than base64's 33%.  Critically,
// because the encoded string contains only ASCII alphanumerics and a
// few safe punctuation characters, it survives any string encoding a
// QR scanner might use (UTF-8, Latin-1, etc.).

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
  assert.ok(encoded instanceof Uint8Array, 'Encoded should be a Uint8Array');

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
  assert.strictEqual(QRFrame.decodeFrame(new Uint8Array([1, 2, 3])), null);
});

test('Decode from Latin-1 string (simulates QR scanner output)', () => {
  const sessionId = 0x1234;
  const K = 50;
  const blockId = 99;
  const payload = new Uint8Array([0x00, 0x7F, 0x80, 0xFF, 0xAB]);

  const frameBytes = QRFrame.encodeFrame(sessionId, K, blockId, payload);
  // Simulate what a QR scanner returns: each byte as a Latin-1 char
  let str = '';
  for (let i = 0; i < frameBytes.length; i++) {
    str += String.fromCharCode(frameBytes[i]);
  }

  const decoded = QRFrame.decodeFrame(str);
  assert.strictEqual(decoded.sessionId, sessionId);
  assert.strictEqual(decoded.K, K);
  assert.strictEqual(decoded.blockId, blockId);
  assert.strictEqual(decoded.payload.length, payload.length);
  for (let i = 0; i < payload.length; i++) {
    assert.strictEqual(decoded.payload[i], payload[i]);
  }
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

// ── Base45 Encoding ──────────────────────────────────────────────────────
// Base45 (RFC 9285) encodes binary data using the 45-character QR
// alphanumeric alphabet.  Two input bytes (value 0–65535) map to three
// characters: value = c₀·45² + c₁·45 + c₂.  A trailing odd byte maps
// to two characters: value = c₀·45 + c₁.  Since 45² = 2025 and
// 44·2025 + 44·45 + 44 = 91124 > 65535, three characters can represent
// any pair of bytes.
//
// These tests verify round-trip fidelity, charset compliance, and
// rejection of invalid input (lowercase, unknown symbols, odd-length
// encoded strings that would indicate a truncated triplet).

console.log('\nBase45 encode/decode:');

test('Round-trip: base45Encode → base45Decode preserves bytes', () => {
  const data = new Uint8Array([0, 1, 127, 128, 255, 0xDE, 0xAD, 0xBE, 0xEF]);
  const encoded = QRFrame.base45Encode(data);
  assert.strictEqual(typeof encoded, 'string', 'Encoded should be a string');

  const decoded = QRFrame.base45Decode(encoded);
  assert.ok(decoded instanceof Uint8Array);
  assert.strictEqual(decoded.length, data.length);
  for (let i = 0; i < data.length; i++) {
    assert.strictEqual(decoded[i], data[i], `Byte mismatch at ${i}`);
  }
});

test('Base45 uses only QR alphanumeric characters', () => {
  const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  const data = new Uint8Array(256);
  for (let i = 0; i < 256; i++) data[i] = i;

  const encoded = QRFrame.base45Encode(data);
  for (let i = 0; i < encoded.length; i++) {
    assert.ok(ALPHANUMERIC.includes(encoded[i]),
      `Character '${encoded[i]}' at index ${i} is not in QR alphanumeric set`);
  }
});

test('Base45 empty input', () => {
  const encoded = QRFrame.base45Encode(new Uint8Array(0));
  assert.strictEqual(encoded, '');
  const decoded = QRFrame.base45Decode('');
  assert.ok(decoded instanceof Uint8Array);
  assert.strictEqual(decoded.length, 0);
});

test('Base45 single byte', () => {
  for (const val of [0, 1, 44, 45, 127, 128, 254, 255]) {
    const data = new Uint8Array([val]);
    const decoded = QRFrame.base45Decode(QRFrame.base45Encode(data));
    assert.strictEqual(decoded.length, 1);
    assert.strictEqual(decoded[0], val, `Failed for byte ${val}`);
  }
});

test('Base45 even and odd length inputs', () => {
  for (let len = 0; len <= 20; len++) {
    const data = new Uint8Array(len);
    for (let i = 0; i < len; i++) data[i] = (i * 37 + 13) & 0xFF;
    const decoded = QRFrame.base45Decode(QRFrame.base45Encode(data));
    assert.strictEqual(decoded.length, len, `Length mismatch for input len=${len}`);
    for (let i = 0; i < len; i++) {
      assert.strictEqual(decoded[i], data[i]);
    }
  }
});

test('Base45 decode rejects invalid characters', () => {
  assert.strictEqual(QRFrame.base45Decode('abc'), null, 'Lowercase should be rejected');
  assert.strictEqual(QRFrame.base45Decode('##'), null, 'Hash should be rejected');
});

test('Base45 decode rejects single leftover character', () => {
  assert.strictEqual(QRFrame.base45Decode('A'), null, 'Single char should be rejected');
});

test('Full QR frame round-trip through base45', () => {
  // Simulates the full sender→receiver pipeline: encodeFrame produces
  // binary bytes, base45Encode makes them QR-safe, the scanner returns
  // the base45 string, base45Decode recovers the bytes, decodeFrame
  // parses the header and payload.
  const sessionId = 0xABCD;
  const K = 150;
  const blockId = 0xDEADBEEF;
  const payload = new Uint8Array(900);
  for (let i = 0; i < 900; i++) payload[i] = i & 0xFF;

  const frameBytes = QRFrame.encodeFrame(sessionId, K, blockId, payload);
  const base45Str = QRFrame.base45Encode(frameBytes);
  const recoveredBytes = QRFrame.base45Decode(base45Str);
  const frame = QRFrame.decodeFrame(recoveredBytes);

  assert.strictEqual(frame.sessionId, sessionId);
  assert.strictEqual(frame.K, K);
  assert.strictEqual(frame.blockId, blockId);
  assert.strictEqual(frame.payload.length, 900);
  for (let i = 0; i < 900; i++) {
    assert.strictEqual(frame.payload[i], payload[i]);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
