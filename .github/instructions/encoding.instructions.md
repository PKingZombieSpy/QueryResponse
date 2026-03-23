# QR Frame Encoding Pipeline

## Wire Format

Each QR code carries one encoded LT block, serialized as:

```
Bytes 0–1:  Session ID  (uint16 BE)   — random per file, locks receiver
Bytes 2–3:  K           (uint16 BE)   — number of source blocks
Bytes 4–7:  Block ID    (uint32 BE)   — PRNG seed for degree + indices
Bytes 8+:   Payload     (blockSize bytes)
```

Total binary frame = 8 + blockSize bytes.

## Forematter

Before chunking, the file is wrapped in a forematter prepended to the
source data:

```
Bytes 0–3:  File content size  (uint32 BE)
Bytes 4–5:  Filename length    (uint16 BE)
Bytes 6+:   Filename           (UTF-8, nameLen bytes)
Then:       Raw file content   (fileSize bytes)
```

The foremattered blob is what gets split into K source blocks.

## Base45 Encoding (RFC 9285)

Frame bytes are base45-encoded before being placed in QR codes.  Base45
uses the 45-character QR alphanumeric set: `0-9 A-Z SP $%*+-./:`.

- Two input bytes → three base45 characters:
  `value = byte[0]*256 + byte[1]` → `c₀·45² + c₁·45 + c₂`
- One trailing byte → two characters:
  `value = byte[0]` → `c₀·45 + c₁`

### Why base45 instead of raw binary?

QR scanners return decoded data as strings.  Different scanner backends
(BarcodeDetector, jsQR) interpret byte-mode data differently — some use
Latin-1, some use UTF-8.  UTF-8 corrupts any byte > 0x7F.  Base45
characters are all ASCII, so they survive any string encoding.

### Why not base64?

Base64 forces QR byte mode (~8 bits/char).  Base45 triggers QR
alphanumeric mode (~5.5 bits/char).  Net overhead:
- Base45: ~3% vs raw binary
- Base64: ~33% vs raw binary

### Sender flow

```
encodeFrame(sessionId, K, blockId, payload) → Uint8Array
  ↓
base45Encode(frameBytes) → string
  ↓
qrcodegen.QrCode.encodeText(base45String, Ecc.LOW) → QR code
```

### Receiver flow

```
QR scanner → result.data (string of alphanumeric chars)
  ↓
base45Decode(result.data) → Uint8Array (or null if not ours)
  ↓
decodeFrame(bytes) → { sessionId, K, blockId, payload }
```

## Block Sizes

| QR Size | Block Size | Frame Bytes | Base45 Chars | Fits in QR v40-L (4296) |
|---------|-----------|-------------|--------------|------------------------|
| Small   | 470       | 478         | 717          | ✓                      |
| Medium  | 900       | 908         | 1362         | ✓                      |
| Large   | 2000      | 2008        | 3012         | ✓                      |

Theoretical max block size with base45: floor(4296 / 1.5) − 8 ≈ 2856.
