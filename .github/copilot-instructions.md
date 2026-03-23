# QueryResponse — Copilot Instructions

## Project Overview

Browser-based file transfer via animated QR codes, using LT fountain codes.
Sender encodes a file into rapidly-cycling QR codes; receiver scans them
with a camera to reconstruct the file.  No backend — everything runs in the
browser.

## Architecture

```
pages/           ← deployed to GitHub Pages (static files only)
  index.html     ← single page; mode toggle, sliders, camera UI
  js/fountain.js ← LT codec: encoder, decoder, Robust Soliton Distribution
  js/qrframe.js  ← frame serialization, forematter, base45 encode/decode
  js/sender.js   ← send mode: file input → LT encode → QR animation
  js/receiver.js ← receive mode: camera → QR scan → LT decode → file save
  js/app.js      ← mode switching, theme toggle
  css/style.css  ← light/dark theme, mobile layout

test/            ← NOT deployed; run with `node test/run-all.js`
  run-all.js     ← discovers and runs all test-*.js files
  test-prng.js, test-distribution.js, test-framing.js, test-codec.js
```

## Key Conventions

- **No build step.**  Vanilla JS, no bundler, no transpiler, no npm.
- **Libraries loaded from CDN** (nayuki-qr-code-generator, qr-scanner).
  Both are MIT-licensed.  Loaded as ES modules in index.html.
- **Tests run under Node** with `node test/run-all.js`.  No test framework —
  just `assert` and a simple pass/fail harness.
- **Git author** for this repo: `PKingZombieSpy <pkingzombiespy@gmail.com>`
  (configured in `.git/config`).
- Do not add a `Co-authored-by: Copilot` trailer to commits in this repo
  (disabled in `.git/config`).

## Things to Avoid

- Do not introduce npm, webpack, or any build tooling.
- Do not replace the CDN-loaded libraries with npm packages.
- Do not use base64 for QR frame encoding (we use base45 — see encoding
  instructions for why).
- Do not use `encodeBinary()` for QR generation — use `encodeText()` with
  base45 strings so scanners can decode reliably.
