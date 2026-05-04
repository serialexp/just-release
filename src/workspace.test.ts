// ABOUTME: Tests for workspace detection across ecosystems
// ABOUTME: Validates package discovery and git-based version resolution

import { test } from 'node:test';
import assert from 'node:assert';
import { detectWorkspace } from './workspace.js';
import { simpleGit } from 'simple-git';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

async function setupGitRepoWithJs(tmpDir: string, version: string) {
  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');
  await writeFile(join(tmpDir, '.gitkeep'), '');
  await git.add('.gitkeep');
  await git.commit('chore: initial');
  await git.commit(`release: ${version}`, ['--allow-empty']);
  return git;
}

test('detectWorkspace reads pnpm-workspace.yaml', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    await setupGitRepoWithJs(tmpDir, '1.0.0');
    await writeFile(
      join(tmpDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\n'
    );
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' })
    );
    await mkdir(join(tmpDir, 'packages', 'pkg-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'package.json'),
      JSON.stringify({ name: 'pkg-a', version: '1.0.0' })
    );

    const result = await detectWorkspace(tmpDir);

    assert.strictEqual(result.rootVersion, '1.0.0');
    assert.strictEqual(result.packages.length, 1);
    assert.strictEqual(result.packages[0].name, 'pkg-a');
    assert.deepStrictEqual(result.detectedEcosystems, ['javascript']);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectWorkspace reads package.json workspaces when no pnpm-workspace.yaml', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    await setupGitRepoWithJs(tmpDir, '2.0.0');
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        version: '2.0.0',
        workspaces: ['packages/*']
      })
    );
    await mkdir(join(tmpDir, 'packages', 'pkg-b'), { recursive: true });
    await writeFile(
      join(tmpDir, 'packages', 'pkg-b', 'package.json'),
      JSON.stringify({ name: 'pkg-b', version: '2.0.0' })
    );

    const result = await detectWorkspace(tmpDir);

    assert.strictEqual(result.rootVersion, '2.0.0');
    assert.strictEqual(result.packages.length, 1);
    assert.strictEqual(result.packages[0].name, 'pkg-b');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectWorkspace throws when no ecosystem detected', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));
  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');
  await writeFile(join(tmpDir, '.gitkeep'), '');
  await git.add('.gitkeep');
  await git.commit('chore: initial');

  try {
    await assert.rejects(
      async () => await detectWorkspace(tmpDir),
      /No ecosystem detected/i
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectWorkspace uses root package when no workspace config found', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    await setupGitRepoWithJs(tmpDir, '3.0.0');
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-package', version: '3.0.0' })
    );

    const result = await detectWorkspace(tmpDir);

    assert.strictEqual(result.rootVersion, '3.0.0');
    assert.strictEqual(result.packages.length, 1);
    assert.strictEqual(result.packages[0].name, 'my-package');
    assert.strictEqual(result.packages[0].path, tmpDir);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectWorkspace gets version from git tag when no release commit', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    const git = simpleGit(tmpDir);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-package', version: '0.0.0' })
    );
    await git.add('.');
    await git.commit('chore: initial');
    await git.addTag('v5.0.0');

    const result = await detectWorkspace(tmpDir);

    assert.strictEqual(result.rootVersion, '5.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectWorkspace falls back to package.json version when no commit or tag', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));

  try {
    const git = simpleGit(tmpDir);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-package', version: '1.0.0' })
    );
    await git.add('.');
    await git.commit('chore: initial');

    const result = await detectWorkspace(tmpDir);

    // No release commit, no tag — fall back to the manifest version rather
    // than silently resetting to 0.0.0.
    assert.strictEqual(result.rootVersion, '1.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
