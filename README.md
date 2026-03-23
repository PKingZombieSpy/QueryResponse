# QueryResponse

Transfer files between devices using animated QR codes, powered by **LT fountain codes** for resilience and redundancy.

## What Is This?

QueryResponse is a zero-setup, browser-based file transfer tool with two modes:

- **Send Mode**: Choose a file from your computer (drag-and-drop or file dialog). The app encodes it using LT fountain codes and displays an animated sequence of QR codes.
- **Receive Mode** (typically on a mobile device): Point the camera at the QR code animation. Codes are scanned and decoded incrementally. Once enough frames are captured, the original file is reconstructed and available for download.

## Why Fountain Codes?

Traditional QR-based file transfer requires receiving *every* chunk in order. Miss one frame and you wait for the entire sequence to loop.

[LT (Luby Transform) codes](https://en.wikipedia.org/wiki/Luby_transform_code) are a class of **fountain codes** that generate a potentially infinite stream of encoded blocks from K source blocks. The receiver only needs approximately **1.1–1.2× the source blocks** to decode, regardless of which blocks are captured or what order they arrive in. This makes transfer:

- **Resilient**: Missed or blurry frames don't require waiting for a retry loop
- **Fast**: No need to capture every frame; missing a few is fine
- **Order-agnostic**: Start scanning at any point in the animation

## How It Works

### Sender Side
1. File is wrapped in a **forematter**: `[file_size:4B][name_length:2B][filename][content]`
2. Foremattered data is split into **K source blocks** (typically ~680 bytes each)
3. An **LT encoder** generates an infinite stream of encoded blocks, each XOR'ing a random subset of source blocks (degree determined by Robust Soliton Distribution)
4. Each encoded block is packaged in a **QR frame** with an 8-byte header:
   - Session ID (2 bytes)
   - K (2 bytes)
   - Block ID / PRNG seed (4 bytes)
5. QR codes are animated on-screen at configurable FPS

### Receiver Side
1. **QR scanner** decodes frames from the camera stream
2. Each frame is deserialized and fed to an **LT decoder**
3. Decoder performs **peeling**: when a block has only 1 unknown source block, it's immediately decoded and XOR'd into other buffered blocks
4. Once K source blocks are decoded, **forematter is parsed** to extract the filename and file content
5. User taps "Save" to download

## Technical Details

| Parameter | Value | Notes |
|---|---|---|
| **Codec** | LT (Luby Transform) | Custom JS implementation; Robust Soliton Distribution with c=0.03, δ=0.05 |
| **PRNG** | xorshift32 + splitmix mixing | Seeded by block ID; deterministic on both sides |
| **Block size** | ~680 bytes (default, configurable) | Trades off between file size and transfer time |
| **Overhead** | 1.1–1.25× (K blocks) | Depends on file size and channel quality |
| **QR version** | ~v22–v40 | Auto-selected by library; binary mode, EC level L |
| **Frame overhead** | 8 bytes header + base64 encoding (~33%) | Total frame ≈920 base64 chars at 680-byte payload |

### Capacity & Timing Estimates

| File Size | Blocks (K) | Frames Needed | Time @ 5 FPS |
|---|---|---|---|
| 100 KB | ~150 | ~165 | ~33 sec |
| 500 KB | ~740 | ~815 | ~2.7 min |
| 1 MB | ~1500 | ~1650 | ~5.5 min |
| 3 MB | ~4460 | ~4900 | ~16.3 min |

Speed depends on FPS, block size, and QR code complexity. Mobile devices with native `BarcodeDetector` API (Android Chrome) scan faster.

## Architecture

```
pages/                  # Deployed to GitHub Pages
├── index.html          # Single page; mode toggle UI
├── js/
│   ├── fountain.js     # LT codec: encoder, decoder, Robust Soliton
│   ├── qrframe.js      # Frame serialization + forematter
│   ├── sender.js       # Send mode: file input, QR animation
│   ├── receiver.js     # Receive mode: camera, scanning, decoding
│   └── app.js          # Main entry, mode switching, theme toggle
└── css/
    └── style.css       # Light/dark theme, mobile-optimized

test/                   # Tests (not deployed)
├── run-all.js          # Test runner
├── test-prng.js        # PRNG quality and seed independence
├── test-distribution.js # Robust Soliton degree distribution
├── test-framing.js     # Frame serialization and forematter
└── test-codec.js       # LT encode/decode round-trips

README.md              # This file
LICENSE                # MIT
.gitignore             # Standard
```

## Running Tests

Tests cover the LT fountain codec, PRNG, degree distribution, and frame
serialization — everything except the browser UI and QR library integration.
Only Node.js is required (no additional dependencies).

```bash
# Run all test suites
node test/run-all.js

# Run individual suites
node test/test-prng.js
node test/test-distribution.js
node test/test-framing.js
node test/test-codec.js
```

## Browser Support

| Browser | Desktop | Mobile |
|---|---|---|
| Chrome | ✅ | ✅ (uses native BarcodeDetector) |
| Firefox | ✅ | ✅ (JS-based QR decoder, slower) |
| Safari | ✅ | ⚠️ (iOS Safari: JS decoder, requires `playsinline`) |
| Edge | ✅ | ✅ |

**Requirements:**
- Camera access (for receive mode)
- Modern browser (ES6+, Uint8Array, Canvas)
- No build step — loads libraries from CDN

## Libraries Used

- **[qrcode-generator](https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/)** — QR generation (canvas output)
- **[qr-scanner](https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/)** — QR scanning (BarcodeDetector + Web Worker fallback)

Both are tiny and loaded via CDN.

## Getting Started

1. Clone or download this repo
2. Serve `pages/` as the root (via `python3 -m http.server`, GitHub Pages, or any static host)
3. Open in two browsers/devices:
   - **Sender**: Choose file, start animation
   - **Receiver**: Point camera at the QR codes, wait for completion

### Local Testing

```bash
cd /path/to/QueryResponse
python3 -m http.server 8000
# Open http://localhost:8000/pages/ in two browser tabs
```

## Design Notes

### Why No Compression?

File size can be reduced by pre-compressing (gzip, brotli). However, modern browsers already have `CompressionStream` API. This is left as optional — the encoder doesn't assume anything about the file format.

### Why No Authentication?

The transfer is point-to-point and visible (literally on the screen). Authentication would add complexity without meaningful security gain for the typical use case. If needed, add a PIN or passphrase outside this app.

### Why Animated QR Instead of WiFi Direct / NFC?

- **Works across any distance/network** — no pairing, no setup
- **Works offline** — no internet required
- **Visual feedback** — user can see transfer progress
- **Resilient** — network dropouts don't affect this channel

## Performance Tuning

- **Increase FPS** (if camera can handle it): Faster transfer, but more QR codes per second
- **Increase block size** (up to ~2190 bytes): Fewer blocks, fewer frames, but larger QR codes
- **Decrease block size** (down to ~100 bytes): Smaller QR codes, easier to scan, but more frames

Experiment with your camera and screen to find the sweet spot.

## Future Ideas

- **Progressive transfer**: Start using blocks as soon as they're decoded, don't wait for completion
- **Multi-file batching**: Send several files in one session
- **Custom error correction**: Let user tune QR EC level
- **Adaptive bitrate**: Measure camera FPS and adjust frame rate
- **WebRTC fallback**: If camera is unavailable, offer peer-to-peer transfer via WebRTC

## License

MIT — See LICENSE file

## References

- [Fountain Codes (Wikipedia)](https://en.wikipedia.org/wiki/Fountain_code)
- [LT Codes (Wikipedia)](https://en.wikipedia.org/wiki/Luby_transform_code)
- [TXQR: Transfer Data via Animated QR](https://github.com/divan/txqr) — Inspiring project using Go + GopherJS
- [Damn Cool Algorithms: Fountain Codes](http://blog.notdot.net/2012/01/Damn-Cool-Algorithms-Fountain-Codes) — Excellent explainer

---

**Author**: PKingZombieSpy  
**Created**: March 2026
