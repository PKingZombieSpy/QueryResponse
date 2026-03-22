// js/fountain.js — LT Fountain Code Encoder/Decoder
// Implements Luby Transform codes with Robust Soliton Distribution

'use strict';

// ── Seeded PRNG (xorshift32) ────────────────────────────────────────────────
// Deterministic: given the same seed, both encoder and decoder produce the
// same sequence, so block composition doesn't need to be transmitted.

class Xorshift32 {
  constructor(seed) {
    // Mix the seed thoroughly (splitmix32-style) so sequential seeds
    // don't produce correlated initial outputs.
    seed = (seed >>> 0) + 0x9e3779b9;
    seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b);
    seed = Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35);
    seed = (seed ^ (seed >>> 16)) >>> 0;
    this.state = seed || 1; // must be nonzero
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  // Returns float in [0, 1)
  nextFloat() {
    return this.next() / 0x100000000;
  }

  // Returns integer in [0, max)
  nextInt(max) {
    return this.next() % max;
  }
}

// ── Robust Soliton Distribution ─────────────────────────────────────────────
// Parameters:
//   K     — number of source blocks
//   c     — free parameter (typically 0.01–0.2)
//   delta — probability of decoding failure (typically 0.05–0.5)
//
// The robust distribution adds a "spike" near degree 1 and a bump at K/S,
// which dramatically improves convergence over the basic (ideal) soliton.

function computeRobustSoliton(K, c = 0.03, delta = 0.05) {
  if (K <= 0) return { cdf: [1.0], pmf: [1.0] };

  const S = c * Math.log(K / delta) * Math.sqrt(K);

  // Ideal Soliton Distribution (rho)
  const rho = new Float64Array(K);
  rho[0] = 1 / K; // degree 1
  for (let d = 2; d <= K; d++) {
    rho[d - 1] = 1 / (d * (d - 1));
  }

  // Tau component (the "robust" addition)
  const tau = new Float64Array(K);
  const pivot = Math.floor(K / S);
  for (let d = 1; d <= K; d++) {
    if (d < pivot) {
      tau[d - 1] = S / (d * K);
    } else if (d === pivot) {
      tau[d - 1] = (S * Math.log(S / delta)) / K;
    }
    // else tau[d-1] = 0 (already initialized)
  }

  // Combine and normalize → mu(d) = (rho(d) + tau(d)) / Z
  let Z = 0;
  const pmf = new Float64Array(K);
  for (let i = 0; i < K; i++) {
    pmf[i] = rho[i] + tau[i];
    Z += pmf[i];
  }
  for (let i = 0; i < K; i++) {
    pmf[i] /= Z;
  }

  // Build CDF for sampling
  const cdf = new Float64Array(K);
  cdf[0] = pmf[0];
  for (let i = 1; i < K; i++) {
    cdf[i] = cdf[i - 1] + pmf[i];
  }
  cdf[K - 1] = 1.0; // clamp floating-point drift

  return { cdf, pmf };
}

// Sample a degree from the CDF using a PRNG
function sampleDegree(cdf, rng) {
  const r = rng.nextFloat();
  // Binary search for the first index where cdf[i] >= r
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1; // degree is 1-indexed
}

// Select `degree` unique source block indices from [0, K) using PRNG
function selectIndices(degree, K, rng) {
  if (degree >= K) {
    // XOR all blocks — return all indices
    const all = new Array(K);
    for (let i = 0; i < K; i++) all[i] = i;
    return all;
  }

  // Fisher-Yates partial shuffle (select `degree` from `K`)
  const pool = new Array(K);
  for (let i = 0; i < K; i++) pool[i] = i;
  const result = new Array(degree);
  for (let i = 0; i < degree; i++) {
    const j = i + rng.nextInt(K - i);
    result[i] = pool[j];
    pool[j] = pool[i];
    pool[i] = result[i];
  }
  return result;
}

// ── LT Encoder ──────────────────────────────────────────────────────────────

class LTEncoder {
  constructor(data, blockSize = 680) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.blockSize = blockSize;
    this.fileSize = this.data.length;

    // Split data into K source blocks
    this.K = Math.ceil(this.data.length / blockSize);
    if (this.K === 0) this.K = 1;

    this.sourceBlocks = new Array(this.K);
    for (let i = 0; i < this.K; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, this.data.length);
      // Pad last block with zeros if necessary
      const block = new Uint8Array(blockSize);
      block.set(this.data.subarray(start, end));
      this.sourceBlocks[i] = block;
    }

    // Precompute Robust Soliton CDF
    const { cdf } = computeRobustSoliton(this.K);
    this.cdf = cdf;

    this.nextBlockId = 0;
  }

  // Generate the next encoded block
  encode() {
    const blockId = this.nextBlockId++;
    return this.encodeBlock(blockId);
  }

  // Generate an encoded block for a specific block ID
  encodeBlock(blockId) {
    const rng = new Xorshift32(blockId + 1); // +1 to avoid seed=0
    const degree = sampleDegree(this.cdf, rng);
    const indices = selectIndices(degree, this.K, rng);

    // XOR selected source blocks together
    const encoded = new Uint8Array(this.blockSize);
    for (const idx of indices) {
      const src = this.sourceBlocks[idx];
      for (let b = 0; b < this.blockSize; b++) {
        encoded[b] ^= src[b];
      }
    }

    return {
      blockId,
      degree,
      indices,
      payload: encoded,
    };
  }
}

// ── LT Decoder ──────────────────────────────────────────────────────────────

class LTDecoder {
  constructor(K, blockSize) {
    this.K = K;
    this.blockSize = blockSize;

    // Precompute same Robust Soliton CDF as encoder
    const { cdf } = computeRobustSoliton(K);
    this.cdf = cdf;

    // Decoded source blocks (null = not yet decoded)
    this.decoded = new Array(K).fill(null);
    this.decodedCount = 0;

    // Buffer of received but unresolved encoded blocks
    // Each entry: { payload: Uint8Array, indices: Set<number> }
    this.buffer = [];

    // Track which block IDs we've already processed (avoid duplicates)
    this.seenBlockIds = new Set();

    // Index: for each source block index, list of buffer entries that reference it
    this.waitingOn = new Array(K);
    for (let i = 0; i < K; i++) {
      this.waitingOn[i] = [];
    }

    this.complete = false;
  }

  get progress() {
    return this.decodedCount / this.K;
  }

  // Receive an encoded block and attempt to decode
  addBlock(blockId, payload) {
    if (this.complete) return true;
    if (this.seenBlockIds.has(blockId)) return false;
    this.seenBlockIds.add(blockId);

    // Reconstruct degree and indices from block ID using same PRNG
    const rng = new Xorshift32(blockId + 1);
    const degree = sampleDegree(this.cdf, rng);
    let indices = selectIndices(degree, this.K, rng);

    // Clone the payload so we can XOR against it
    const data = new Uint8Array(payload);

    // "Scrub" — XOR out any already-decoded source blocks
    const remaining = [];
    for (const idx of indices) {
      if (this.decoded[idx] !== null) {
        const src = this.decoded[idx];
        for (let b = 0; b < this.blockSize; b++) {
          data[b] ^= src[b];
        }
      } else {
        remaining.push(idx);
      }
    }

    if (remaining.length === 0) {
      // All source blocks already known — this encoded block is redundant
      return false;
    }

    if (remaining.length === 1) {
      // Resolved! This gives us a source block directly
      this._resolve(remaining[0], data);
      return this.complete;
    }

    // More than 1 unknown — buffer it and wait
    const entry = { data, indices: new Set(remaining) };
    this.buffer.push(entry);

    // Register in the waiting-on index
    for (const idx of remaining) {
      this.waitingOn[idx].push(entry);
    }

    return false;
  }

  // Mark a source block as decoded and cascade
  _resolve(idx, data) {
    if (this.decoded[idx] !== null) return; // already decoded

    this.decoded[idx] = data;
    this.decodedCount++;

    if (this.decodedCount === this.K) {
      this.complete = true;
      return;
    }

    // Propagate: XOR this block out of all buffered entries that reference it
    const waiting = this.waitingOn[idx];
    this.waitingOn[idx] = [];

    const newlyResolved = [];

    for (const entry of waiting) {
      if (!entry.indices.has(idx)) continue;

      // XOR out the newly decoded block
      for (let b = 0; b < this.blockSize; b++) {
        entry.data[b] ^= data[b];
      }
      entry.indices.delete(idx);

      if (entry.indices.size === 1) {
        // This entry just became resolvable
        const resolvedIdx = entry.indices.values().next().value;
        newlyResolved.push({ idx: resolvedIdx, data: entry.data });
        entry.indices.clear(); // mark as consumed
      }
    }

    // Cascade — resolve newly single-index entries
    for (const { idx: rIdx, data: rData } of newlyResolved) {
      if (this.decoded[rIdx] === null) {
        this._resolve(rIdx, rData);
        if (this.complete) return;
      }
    }
  }

  // Reconstruct the full decoded data (K * blockSize bytes, including padding)
  getData() {
    if (!this.complete) return null;

    const result = new Uint8Array(this.K * this.blockSize);
    for (let i = 0; i < this.K; i++) {
      result.set(this.decoded[i], i * this.blockSize);
    }
    return result;
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────
// Attach to globalThis for use without a module bundler
if (typeof globalThis !== 'undefined') {
  globalThis.Fountain = { LTEncoder, LTDecoder, Xorshift32, computeRobustSoliton };
}
