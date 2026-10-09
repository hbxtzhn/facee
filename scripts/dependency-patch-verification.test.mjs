import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDependencyBackports } from './verify-dependency-patches.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(run) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'facee-patch-verification-'));
  try {
    cpSync(join(root, 'patches'), join(projectRoot, 'patches'), { recursive: true });
    cpSync(join(root, 'pnpm-workspace.yaml'), join(projectRoot, 'pnpm-workspace.yaml'));
    run(projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}
const check = projectRoot => verifyDependencyBackports({ projectRoot, runRegression: false });

test('security gate recognizes registered and applied backports', () => fixture(projectRoot => {
  assert.equal(check(projectRoot).size, 2);
}));

test('security gate rejects altered patch bytes', () => fixture(projectRoot => {
  writeFileSync(join(projectRoot, 'patches/braces@3.0.3.patch'), 'unreviewed patch');
  assert.throws(() => check(projectRoot), /Unverified security patch registration/);
}));

test('security gate rejects missing pnpm patch registration', () => fixture(projectRoot => {
  const file = join(projectRoot, 'pnpm-workspace.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('braces@3.0.3: patches/braces@3.0.3.patch', ''));
  assert.throws(() => check(projectRoot), /Unverified security patch registration/);
}));

test('security gate rejects incomplete installed-file fingerprint coverage', () => fixture(projectRoot => {
  const file = join(projectRoot, 'patches/security-backports.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  delete manifest['GHSA-vfj7-8cjw-p6xm'].files['lib/parse.js'];
  writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => check(projectRoot), /Unverified security patch registration/);
}));
