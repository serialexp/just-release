// ABOUTME: Tests for GitHub API integration and PR management
// ABOUTME: Validates PR creation, updates, and release branch detection

import { test } from 'node:test';
import assert from 'node:assert';
import { getRepoInfo, findExistingReleaseBranch } from './github.js';
import { simpleGit, SimpleGit } from 'simple-git';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

test('getRepoInfo extracts owner and repo from git remote', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-git-'));

  try {
    const git: SimpleGit = simpleGit(tmpDir);
    await git.init();
    await git.addRemote(
      'origin',
      'https://github.com/test-owner/test-repo.git'
    );

    const repoInfo = await getRepoInfo(tmpDir);

    assert.strictEqual(repoInfo.owner, 'test-owner');
    assert.strictEqual(repoInfo.repo, 'test-repo');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getRepoInfo handles SSH remote URLs', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-git-'));

  try {
    const git: SimpleGit = simpleGit(tmpDir);
    await git.init();
    await git.addRemote('origin', 'git@github.com:test-owner/test-repo.git');

    const repoInfo = await getRepoInfo(tmpDir);

    assert.strictEqual(repoInfo.owner, 'test-owner');
    assert.strictEqual(repoInfo.repo, 'test-repo');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('findExistingReleaseBranch returns null when no release branches exist', () => {
  const branches = [
    { name: 'main' },
    { name: 'feature/test' },
    { name: 'bugfix/issue-123' },
  ];

  const result = findExistingReleaseBranch(branches as any);

  assert.strictEqual(result, null);
});

test('findExistingReleaseBranch finds release branch', () => {
  const branches = [
    { name: 'main' },
    { name: 'release/2024-01-15' },
    { name: 'feature/test' },
  ];

  const result = findExistingReleaseBranch(branches as any);

  assert.strictEqual(result, 'release/2024-01-15');
});

test('findExistingReleaseBranch returns first release branch when multiple exist', () => {
  const branches = [
    { name: 'main' },
    { name: 'release/2024-01-15' },
    { name: 'release/2024-01-16' },
  ];

  const result = findExistingReleaseBranch(branches as any);

  assert.strictEqual(result, 'release/2024-01-15');
});

test('findExistingReleaseBranch ignores non-date release branches', () => {
  const branches = [
    { name: 'main' },
    { name: 'release/2.55.0' },
    { name: 'release/v1.0.0' },
    { name: 'release/foo' },
  ];

  const result = findExistingReleaseBranch(branches as any);

  assert.strictEqual(result, null);
});

test('findExistingReleaseBranch picks date branch over non-date branch', () => {
  const branches = [
    { name: 'main' },
    { name: 'release/2.55.0' },
    { name: 'release/2024-01-15' },
  ];

  const result = findExistingReleaseBranch(branches as any);

  assert.strictEqual(result, 'release/2024-01-15');
});
