// ABOUTME: Tests for post-release detection from git history
// ABOUTME: Validates detection of release commits in squash merges, regular merges, and non-release scenarios

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { detectPostRelease } from './post-release.js';
import { simpleGit, SimpleGit } from 'simple-git';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const tmpDirs: string[] = [];

async function setupGitRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = await mkdtemp(join(tmpdir(), 'test-post-release-'));
  tmpDirs.push(dir);
  const git = simpleGit(dir);

  // Force the initial branch to `main` regardless of the user's
  // `init.defaultBranch` setting — the regular-merge test below checks
  // out `main` explicitly, and would fail on machines where git defaults
  // to `master`.
  await git.init(['--initial-branch=main']);
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');

  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
  await git.add('package.json');
  await git.commit('chore: initial commit');

  return { dir, git };
}

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe('detectPostRelease', () => {
  it('should detect a squash-merged release commit at HEAD', async () => {
    const { dir, git } = await setupGitRepo();

    await writeFile(join(dir, 'file.txt'), 'change');
    await git.add('file.txt');
    await git.commit('release: 1.1.0');

    const result = await detectPostRelease(dir);
    assert.strictEqual(result, true);
  });

  it('should detect a release commit in a regular merge (release commit is parent)', async () => {
    const { dir, git } = await setupGitRepo();

    // Create a release branch with a release commit
    await git.checkoutLocalBranch('release/2024-01-15');
    await writeFile(join(dir, 'file.txt'), 'change');
    await git.add('file.txt');
    await git.commit('release: 1.1.0');

    // Merge back to main (creates a merge commit)
    await git.checkout('main');
    await git.merge(['release/2024-01-15', '--no-ff']);

    const result = await detectPostRelease(dir);
    assert.strictEqual(result, true);
  });

  it('should NOT detect post-release for a normal commit after a release', async () => {
    const { dir, git } = await setupGitRepo();

    // Release commit
    await writeFile(join(dir, 'file.txt'), 'release change');
    await git.add('file.txt');
    await git.commit('release: 1.1.0');

    // Normal commit after release
    await writeFile(join(dir, 'file2.txt'), 'fix change');
    await git.add('file2.txt');
    await git.commit('fix: add top-level main/types fields for older moduleResolution');

    const result = await detectPostRelease(dir);
    assert.strictEqual(result, false);
  });

  it('should NOT detect post-release for a normal commit two after a release', async () => {
    const { dir, git } = await setupGitRepo();

    // Release commit
    await writeFile(join(dir, 'file.txt'), 'release change');
    await git.add('file.txt');
    await git.commit('release: 1.1.0');

    // Two normal commits after release
    await writeFile(join(dir, 'file2.txt'), 'change 1');
    await git.add('file2.txt');
    await git.commit('fix: first fix');

    await writeFile(join(dir, 'file3.txt'), 'change 2');
    await git.add('file3.txt');
    await git.commit('feat: second feature');

    const result = await detectPostRelease(dir);
    assert.strictEqual(result, false);
  });

  it('should NOT detect post-release for a regular commit on a branch', async () => {
    const { dir, git } = await setupGitRepo();

    const result = await detectPostRelease(dir);
    assert.strictEqual(result, false);
  });
});
