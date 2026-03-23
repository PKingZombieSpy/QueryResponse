# Testing Conventions

## Running Tests

```bash
node test/run-all.js          # all suites
node test/test-prng.js         # individual suite
```

No test framework — tests use Node's built-in `assert` module and a
minimal pass/fail harness.  Each test file exports nothing; it runs
on `node` directly and exits 0 (all pass) or 1 (any failure).

## Test Structure

Each test file follows this pattern:

```javascript
#!/usr/bin/env node
'use strict';

require('../pages/js/fountain.js');  // loads into globalThis
require('../pages/js/qrframe.js');

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// ... tests ...

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

Source files attach exports to `globalThis` (e.g. `globalThis.Fountain`,
`globalThis.QRFrame`), so `require()` in tests makes them available as
globals — no import/export machinery needed.

## What Each Suite Covers

- **test-prng.js** — Xorshift32 determinism, splitmix mixing quality,
  nextFloat/nextInt uniformity, zero-state avoidance.
- **test-distribution.js** — Robust Soliton PMF/CDF validity, chi-squared
  goodness-of-fit vs empirical sampling, degree-1 frequency.
- **test-framing.js** — Frame encode/decode round-trips, forematter,
  edge values, base45 encode/decode, full QR frame pipeline through base45.
- **test-codec.js** — LT encode/decode round-trips at various sizes,
  overhead ratio bounds, duplicate/out-of-order resilience, K=1 and K=2
  edge cases.

## Adding a New Test

1. Create `test/test-<name>.js` following the pattern above.
2. `run-all.js` auto-discovers files matching `test-*.js` — no registration
   needed.
3. Tests must be runnable under Node without a browser.  The source files
   in `pages/js/` are written to work in both environments (they use
   `globalThis` rather than `window`).
4. Keep tests in `test/`, not in `pages/` — only `pages/` is deployed.
