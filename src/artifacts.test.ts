// ABOUTME: Tests for workflow-artifact extraction used to build release assets
// ABOUTME: Exercises the in-memory zip unpacking (network paths follow the
// ABOUTME: repo convention of not unit-testing octokit-constructing functions)

import { test } from 'node:test';
import assert from 'node:assert';
import { zipSync, strToU8 } from 'fflate';
import { extractZip } from './artifacts.js';

test('extractZip returns each file with its bytes', () => {
  const zip = zipSync({
    'ws-darwin-arm64': strToU8('binary-contents'),
    'ws-darwin-arm64.sha256': strToU8('deadbeef  ws-darwin-arm64\n'),
  });

  const files = extractZip(zip).sort((a, b) => a.name.localeCompare(b.name));

  assert.strictEqual(files.length, 2);
  assert.strictEqual(files[0].name, 'ws-darwin-arm64');
  assert.strictEqual(files[0].data.toString(), 'binary-contents');
  assert.strictEqual(files[1].name, 'ws-darwin-arm64.sha256');
  assert.strictEqual(files[1].data.toString(), 'deadbeef  ws-darwin-arm64\n');
});

test('extractZip collapses nested paths to the basename', () => {
  const zip = zipSync({
    'dist/nested/ws-linux-amd64': strToU8('elf'),
  });

  const files = extractZip(zip);

  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].name, 'ws-linux-amd64');
  assert.strictEqual(files[0].data.toString(), 'elf');
});

test('extractZip skips directory entries', () => {
  const zip = zipSync({
    'dist/': strToU8(''),
    'dist/ws': strToU8('x'),
  });

  const files = extractZip(zip);

  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].name, 'ws');
});

test('extractZip handles an empty archive', () => {
  const zip = zipSync({});
  assert.deepStrictEqual(extractZip(zip), []);
});

test('extractZip preserves binary (non-UTF8) bytes', () => {
  const raw = new Uint8Array([0x00, 0xff, 0x10, 0x7f, 0x80]);
  const zip = zipSync({ 'blob.bin': raw });

  const files = extractZip(zip);

  assert.strictEqual(files.length, 1);
  assert.deepStrictEqual(new Uint8Array(files[0].data), raw);
});
