// ABOUTME: Tests for version bump calculation based on conventional commits
// ABOUTME: Validates semver bump logic for major, minor, and patch versions

import { test } from 'node:test';
import assert from 'node:assert';
import { calculateVersionBump, BumpType } from './version.js';
import { CommitInfo } from './commits.js';

test('calculateVersionBump returns major for breaking changes', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: 'feat',
      scope: null,
      subject: 'breaking change',
      body: null,
      breaking: true,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'feat!: breaking change',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'major');
  assert.strictEqual(result.newVersion, '2.0.0');
});

test('calculateVersionBump returns minor for feat commits', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: 'feat',
      scope: null,
      subject: 'add feature',
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'feat: add feature',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'minor');
  assert.strictEqual(result.newVersion, '1.1.0');
});

test('calculateVersionBump returns patch for fix commits', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: 'fix',
      scope: null,
      subject: 'fix bug',
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'fix: fix bug',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'patch');
  assert.strictEqual(result.newVersion, '1.0.1');
});

test('calculateVersionBump returns patch for only chore commits', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: 'chore',
      scope: null,
      subject: 'update readme',
      body: null,
      breaking: false,
      packages: [],
      files: ['README.md'],
      rawMessage: 'chore: update readme',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'patch');
  assert.strictEqual(result.newVersion, '1.0.1');
});

test('calculateVersionBump returns patch for only docs commits', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: 'docs',
      scope: null,
      subject: 'update docs',
      body: null,
      breaking: false,
      packages: [],
      files: ['docs/README.md'],
      rawMessage: 'docs: update docs',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'patch');
  assert.strictEqual(result.newVersion, '1.0.1');
});

test('calculateVersionBump prioritizes breaking over feat', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: 'feat',
      scope: null,
      subject: 'add feature',
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'feat: add feature',
    },
    {
      hash: 'def456',
      type: 'fix',
      scope: null,
      subject: 'breaking fix',
      body: null,
      breaking: true,
      packages: ['pkg-b'],
      files: ['packages/pkg-b/index.js'],
      rawMessage: 'fix!: breaking fix',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'major');
  assert.strictEqual(result.newVersion, '2.0.0');
});

test('calculateVersionBump prioritizes feat over fix', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: 'fix',
      scope: null,
      subject: 'fix bug',
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'fix: fix bug',
    },
    {
      hash: 'def456',
      type: 'feat',
      scope: null,
      subject: 'add feature',
      body: null,
      breaking: false,
      packages: ['pkg-b'],
      files: ['packages/pkg-b/index.js'],
      rawMessage: 'feat: add feature',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'minor');
  assert.strictEqual(result.newVersion, '1.1.0');
});

test('calculateVersionBump returns null for empty commits', () => {
  const commits: CommitInfo[] = [];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, null);
  assert.strictEqual(result.newVersion, null);
});

test('calculateVersionBump returns patch for only non-conventional commits', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: null,
      scope: null,
      subject: null,
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'Update readme',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'patch');
  assert.strictEqual(result.newVersion, '1.0.1');
});

test('calculateVersionBump still bumps when non-conventional commits mixed with feat', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: null,
      scope: null,
      subject: null,
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'Update readme',
    },
    {
      hash: 'def456',
      type: 'feat',
      scope: null,
      subject: 'add feature',
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'feat: add feature',
    },
  ];

  const result = calculateVersionBump('1.0.0', commits);

  assert.strictEqual(result.bumpType, 'minor');
  assert.strictEqual(result.newVersion, '1.1.0');
});
