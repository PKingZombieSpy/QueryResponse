// js/qrframe.js — Frame serialization for QR code transport
// Converts structured data ↔ base64 strings suitable for QR codes
//
// QR frame header (8 bytes):
//   Bytes 0–1:  Session ID (uint16 BE)
//   Bytes 2–3:  K (uint16 BE) — number of source blocks
//   Bytes 4–7:  Block ID (uint32 BE) — PRNG seed for degree + indices
//   Bytes 8+:   Encoded payload (block_size bytes, inferred from length)
//
// File forematter (prepended to file content before chunking):
//   Bytes 0–3:  File content size (uint32 BE)
//   Bytes 4–5:  Filename length (uint16 BE)
//   Bytes 6+:   Filename (UTF-8, nameLen bytes)
//   Then:       Raw file content (fileSize bytes)

'use strict';

const HEADER_SIZE = 8;

// ── QR Frame Encoding/Decoding ──────────────────────────────────────────────

function encodeFrame(sessionId, K, blockId, payload) {
  const frame = new Uint8Array(HEADER_SIZE + payload.length);
  const view = new DataView(frame.buffer);

  view.setUint16(0, sessionId, false);
  view.setUint16(2, K, false);
  view.setUint32(4, blockId, false);
  frame.set(payload, HEADER_SIZE);

  return uint8ToBase64(frame);
}

function decodeFrame(base64String) {
  const frame = base64ToUint8(base64String);
  if (frame.length < HEADER_SIZE) return null;

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  return {
    sessionId: view.getUint16(0, false),
    K: view.getUint16(2, false),
    blockId: view.getUint32(4, false),
    payload: frame.slice(HEADER_SIZE),
  };
}

// ── File Forematter ─────────────────────────────────────────────────────────

function buildForemattedData(filename, fileContent) {
  const nameBytes = new TextEncoder().encode(filename);
  const forematter = new Uint8Array(6 + nameBytes.length + fileContent.length);
  const view = new DataView(forematter.buffer);

  view.setUint32(0, fileContent.length, false);
  view.setUint16(4, nameBytes.length, false);
  forematter.set(nameBytes, 6);
  forematter.set(fileContent, 6 + nameBytes.length);

  return forematter;
}

function parseForemattedData(rawData) {
  if (rawData.length < 6) return null;

  const view = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
  const fileSize = view.getUint32(0, false);
  const nameLen = view.getUint16(4, false);

  if (rawData.length < 6 + nameLen + fileSize) return null;

  const filename = new TextDecoder().decode(rawData.slice(6, 6 + nameLen));
  const content = rawData.slice(6 + nameLen, 6 + nameLen + fileSize);

  return { filename, content, fileSize };
}

// ── Base64 helpers ──────────────────────────────────────────────────────────

function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Exports ─────────────────────────────────────────────────────────────────
if (typeof globalThis !== 'undefined') {
  globalThis.QRFrame = {
    encodeFrame,
    decodeFrame,
    buildForemattedData,
    parseForemattedData,
    uint8ToBase64,
    base64ToUint8,
    HEADER_SIZE,
  };
}
