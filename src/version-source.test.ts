// ABOUTME: Tests for git-based version resolution
// ABOUTME: Validates priority: release commit → git tag → 0.0.0

import { test } from 'node:test';
import assert from 'node:assert';
import { resolveCurrentVersion } from './version-source.js';
import { simpleGit } from 'simple-git';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

async function setupGitRepo(): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-vsrc-'));
  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');

  // Need at least one commit
  await writeFile(join(tmpDir, 'README.md'), '# test');
  await git.add('README.md');
  await git.commit('chore: initial commit');

  return tmpDir;
}

test('resolveCurrentVersion returns version from release commit', async () => {
  const tmpDir = await setupGitRepo();
  const git = simpleGit(tmpDir);

  try {
    await git.commit('release: 1.2.3', ['--allow-empty']);

    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '1.2.3');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion returns version from chore release commit', async () => {
  const tmpDir = await setupGitRepo();
  const git = simpleGit(tmpDir);

  try {
    await git.commit('chore: release v2.0.0', ['--allow-empty']);

    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '2.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion finds release commit even when not HEAD', async () => {
  const tmpDir = await setupGitRepo();
  const git = simpleGit(tmpDir);

  try {
    await git.commit('release: 1.0.0', ['--allow-empty']);
    await git.commit('feat: new feature', ['--allow-empty']);
    await git.commit('fix: bug fix', ['--allow-empty']);

    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '1.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion falls back to git tag when no release commits', async () => {
  const tmpDir = await setupGitRepo();
  const git = simpleGit(tmpDir);

  try {
    await git.addTag('v3.5.0');
    await git.commit('feat: something', ['--allow-empty']);

    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '3.5.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion handles tag without v prefix', async () => {
  const tmpDir = await setupGitRepo();
  const git = simpleGit(tmpDir);

  try {
    await git.addTag('4.0.0');

    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '4.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion prefers release commit over tag', async () => {
  const tmpDir = await setupGitRepo();
  const git = simpleGit(tmpDir);

  try {
    await git.addTag('v1.0.0');
    await git.commit('release: 2.0.0', ['--allow-empty']);
    await git.commit('feat: new stuff', ['--allow-empty']);

    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '2.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion returns 0.0.0 when nothing found', async () => {
  const tmpDir = await setupGitRepo();

  try {
    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '0.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion picks latest tag by semver sort', async () => {
  const tmpDir = await setupGitRepo();
  const git = simpleGit(tmpDir);

  try {
    await git.addTag('v1.0.0');
    await git.commit('chore: bump', ['--allow-empty']);
    await git.addTag('v2.0.0');
    await git.commit('chore: another', ['--allow-empty']);
    await git.addTag('v1.5.0');

    const version = await resolveCurrentVersion(tmpDir);
    // --sort=-v:refname should put v2.0.0 first
    assert.strictEqual(version, '2.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion falls back to package.json when no commit or tag', async () => {
  const tmpDir = await setupGitRepo();
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.1.0-alpha.16' }),
    );
    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '0.1.0-alpha.16');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion falls back to Cargo.toml when no commit, tag, or package.json', async () => {
  const tmpDir = await setupGitRepo();
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[package]\nname = "x"\nversion = "1.2.3-beta.1"\n',
    );
    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '1.2.3-beta.1');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCurrentVersion prefers git tag over manifest fallback', async () => {
  const tmpDir = await setupGitRepo();
  const git = simpleGit(tmpDir);
  try {
    await git.addTag('v5.0.0');
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.1.0-alpha.16' }),
    );
    const version = await resolveCurrentVersion(tmpDir);
    assert.strictEqual(version, '5.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
