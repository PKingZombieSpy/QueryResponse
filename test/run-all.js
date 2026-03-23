#!/usr/bin/env node
// test/run-all.js — Run all test suites

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const suites = [
  'test-prng.js',
  'test-distribution.js',
  'test-framing.js',
  'test-codec.js',
];

let allPassed = true;

for (const suite of suites) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Running ${suite}`);
  console.log('═'.repeat(60));

  try {
    execSync(`node ${path.join(__dirname, suite)}`, { stdio: 'inherit' });
  } catch (e) {
    allPassed = false;
  }
}

console.log(`\n${'═'.repeat(60)}`);
if (allPassed) {
  console.log('All test suites passed.');
} else {
  console.log('Some test suites FAILED.');
}
console.log('═'.repeat(60));

process.exit(allPassed ? 0 : 1);
