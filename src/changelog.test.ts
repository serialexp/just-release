// ABOUTME: Tests for changelog generation per workspace package
// ABOUTME: Validates markdown formatting and version section creation

import { test } from 'node:test';
import assert from 'node:assert';
import { generateChangelogs, generateChangelogSection } from './changelog.js';
import { CommitInfo } from './commits.js';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

test('generateChangelogs creates changelog for package with changes', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    await mkdir(join(tmpDir, 'packages', 'pkg-a'), { recursive: true });

    const commits: CommitInfo[] = [
      {
        hash: 'abc123',
        type: 'feat',
        scope: null,
        subject: 'add new feature',
        body: null,
        breaking: false,
        packages: ['pkg-a'],
        files: ['packages/pkg-a/index.js'],
        rawMessage: 'feat: add new feature',
        releaseAs: null,
      },
    ];

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    await generateChangelogs('1.1.0', commits, packages);

    const changelog = await readFile(
      join(tmpDir, 'packages', 'pkg-a', 'CHANGELOG.md'),
      'utf-8'
    );

    assert.ok(changelog.includes('## 1.1.0'));
    assert.ok(changelog.includes('### Features'));
    assert.ok(changelog.includes('add new feature'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateChangelogs skips package with no changes', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    await mkdir(join(tmpDir, 'packages', 'pkg-a'), { recursive: true });
    await mkdir(join(tmpDir, 'packages', 'pkg-b'), { recursive: true });

    const commits: CommitInfo[] = [
      {
        hash: 'abc123',
        type: 'feat',
        scope: null,
        subject: 'add new feature',
        body: null,
        breaking: false,
        packages: ['pkg-a'],
        files: ['packages/pkg-a/index.js'],
        rawMessage: 'feat: add new feature',
        releaseAs: null,
      },
    ];

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
      { name: 'pkg-b', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-b') },
    ];

    await generateChangelogs('1.1.0', commits, packages);

    const pkgAChangelog = await readFile(
      join(tmpDir, 'packages', 'pkg-a', 'CHANGELOG.md'),
      'utf-8'
    );
    assert.ok(pkgAChangelog.includes('## 1.1.0'));

    // pkg-b should not have a changelog
    await assert.rejects(
      async () =>
        await readFile(
          join(tmpDir, 'packages', 'pkg-b', 'CHANGELOG.md'),
          'utf-8'
        ),
      /ENOENT/
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateChangelogs groups commits by type', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    await mkdir(join(tmpDir, 'packages', 'pkg-a'), { recursive: true });

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
        releaseAs: null,
      },
      {
        hash: 'def456',
        type: 'fix',
        scope: null,
        subject: 'fix bug',
        body: null,
        breaking: false,
        packages: ['pkg-a'],
        files: ['packages/pkg-a/index.js'],
        rawMessage: 'fix: fix bug',
        releaseAs: null,
      },
    ];

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    await generateChangelogs('1.1.0', commits, packages);

    const changelog = await readFile(
      join(tmpDir, 'packages', 'pkg-a', 'CHANGELOG.md'),
      'utf-8'
    );

    assert.ok(changelog.includes('### Features'));
    assert.ok(changelog.includes('add feature'));
    assert.ok(changelog.includes('### Bug Fixes'));
    assert.ok(changelog.includes('fix bug'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateChangelogs highlights breaking changes', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    await mkdir(join(tmpDir, 'packages', 'pkg-a'), { recursive: true });

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
        releaseAs: null,
      },
    ];

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    await generateChangelogs('2.0.0', commits, packages);

    const changelog = await readFile(
      join(tmpDir, 'packages', 'pkg-a', 'CHANGELOG.md'),
      'utf-8'
    );

    assert.ok(changelog.includes('### BREAKING CHANGES'));
    assert.ok(changelog.includes('breaking change'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateChangelogs prepends to existing changelog', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    await mkdir(join(tmpDir, 'packages', 'pkg-a'), { recursive: true });

    const existingChangelog = `# Changelog

## 1.0.0 (2024-01-01)

### Features

- initial release
`;

    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'CHANGELOG.md'),
      existingChangelog
    );

    const commits: CommitInfo[] = [
      {
        hash: 'abc123',
        type: 'feat',
        scope: null,
        subject: 'add new feature',
        body: null,
        breaking: false,
        packages: ['pkg-a'],
        files: ['packages/pkg-a/index.js'],
        rawMessage: 'feat: add new feature',
        releaseAs: null,
      },
    ];

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    await generateChangelogs('1.1.0', commits, packages);

    const changelog = await readFile(
      join(tmpDir, 'packages', 'pkg-a', 'CHANGELOG.md'),
      'utf-8'
    );

    assert.ok(changelog.includes('## 1.1.0'));
    assert.ok(changelog.includes('add new feature'));
    assert.ok(changelog.includes('## 1.0.0'));
    assert.ok(changelog.includes('initial release'));

    // New version should come before old version
    const newVersionIndex = changelog.indexOf('## 1.1.0');
    const oldVersionIndex = changelog.indexOf('## 1.0.0');
    assert.ok(newVersionIndex < oldVersionIndex);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateChangelogSection puts non-conventional commits in Other section', () => {
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
      rawMessage: 'Update readme and fix typos',
      releaseAs: null,
    },
  ];

  const section = generateChangelogSection('1.1.0', commits);

  assert.ok(section.includes('### Other'));
  assert.ok(section.includes('Update readme and fix typos'));
  assert.ok(!section.includes('### Features'));
  assert.ok(!section.includes('### Bug Fixes'));
});

test('generateChangelogSection uses rawMessage fallback when subject is null', () => {
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
      rawMessage: 'Just a plain commit message',
      releaseAs: null,
    },
  ];

  const section = generateChangelogSection('1.0.1', commits);

  assert.ok(section.includes('- Just a plain commit message'));
});

test('generateChangelogSection handles mix of conventional and non-conventional commits', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: 'feat',
      scope: null,
      subject: 'add new feature',
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'feat: add new feature',
      releaseAs: null,
    },
    {
      hash: 'def456',
      type: null,
      scope: null,
      subject: null,
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/README.md'],
      rawMessage: 'Update documentation',
      releaseAs: null,
    },
    {
      hash: 'ghi789',
      type: 'fix',
      scope: null,
      subject: 'resolve crash on startup',
      body: null,
      breaking: false,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'fix: resolve crash on startup',
      releaseAs: null,
    },
  ];

  const section = generateChangelogSection('1.1.0', commits);

  assert.ok(section.includes('### Features'));
  assert.ok(section.includes('add new feature'));
  assert.ok(section.includes('### Bug Fixes'));
  assert.ok(section.includes('resolve crash on startup'));
  assert.ok(section.includes('### Other'));
  assert.ok(section.includes('Update documentation'));
});

test('generateChangelogSection does not put breaking non-conventional commits in Other', () => {
  const commits: CommitInfo[] = [
    {
      hash: 'abc123',
      type: null,
      scope: null,
      subject: null,
      body: null,
      breaking: true,
      packages: ['pkg-a'],
      files: ['packages/pkg-a/index.js'],
      rawMessage: 'Completely rewrite the API',
      releaseAs: null,
    },
  ];

  const section = generateChangelogSection('2.0.0', commits);

  assert.ok(section.includes('### BREAKING CHANGES'));
  assert.ok(section.includes('Completely rewrite the API'));
  assert.ok(!section.includes('### Other'));
});
