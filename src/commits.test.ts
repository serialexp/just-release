// ABOUTME: Tests for git commit analysis and conventional commit parsing
// ABOUTME: Validates commit categorization and file-to-package mapping

import { test } from 'node:test';
import assert from 'node:assert';
import { analyzeCommits, CommitInfo } from './commits.js';
import { simpleGit, SimpleGit } from 'simple-git';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

async function setupGitRepo(): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-git-'));
  const git: SimpleGit = simpleGit(tmpDir);

  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');

  // Create root package.json
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'root', version: '1.0.0' })
  );
  await git.add('package.json');
  await git.commit('chore: initial commit');

  // Create workspace packages
  await mkdir(join(tmpDir, 'packages', 'pkg-a'), { recursive: true });
  await writeFile(
    join(tmpDir, 'packages', 'pkg-a', 'package.json'),
    JSON.stringify({ name: 'pkg-a', version: '1.0.0' })
  );
  await writeFile(join(tmpDir, 'packages', 'pkg-a', 'index.js'), '// pkg-a');

  await mkdir(join(tmpDir, 'packages', 'pkg-b'), { recursive: true });
  await writeFile(
    join(tmpDir, 'packages', 'pkg-b', 'package.json'),
    JSON.stringify({ name: 'pkg-b', version: '1.0.0' })
  );
  await writeFile(join(tmpDir, 'packages', 'pkg-b', 'index.js'), '// pkg-b');

  await git.add('.');
  await git.commit('chore: add packages');

  // Add a release commit to mark the boundary
  await git.commit('release: 1.0.0', ['--allow-empty']);

  return tmpDir;
}

test('analyzeCommits parses feat commits', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    // Add a feature commit
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'index.js'),
      '// pkg-a feature'
    );
    await git.add('.');
    await git.commit('feat: add new feature to pkg-a');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
      { name: 'pkg-b', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-b') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].type, 'feat');
    assert.strictEqual(commits[0].subject, 'add new feature to pkg-a');
    assert.ok(commits[0].packages.includes('pkg-a'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits parses fix commits', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await writeFile(
      join(tmpDir, 'packages', 'pkg-b', 'index.js'),
      '// pkg-b fix'
    );
    await git.add('.');
    await git.commit('fix: resolve bug in pkg-b');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
      { name: 'pkg-b', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-b') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].type, 'fix');
    assert.ok(commits[0].packages.includes('pkg-b'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits detects breaking changes', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'index.js'),
      '// breaking change'
    );
    await git.add('.');
    await git.commit('feat!: breaking change in API\n\nBREAKING CHANGE: API changed');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].breaking, true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits ignores chore commits', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await writeFile(join(tmpDir, 'README.md'), '# Test');
    await git.add('.');
    await git.commit('chore: update readme');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    // Should still return the commit, but it will be filtered later when calculating version bump
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].type, 'chore');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits attributes all changes to root in single-package repo', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-git-'));
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Create single package repo (no workspace)
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '1.0.0' })
    );
    await git.add('package.json');
    await git.commit('chore: initial commit');
    await git.commit('release: 1.0.0', ['--allow-empty']);

    // Add a feature commit
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'index.ts'), 'console.log("hello")');
    await git.add('.');
    await git.commit('feat: add hello world');

    const workspacePackages = [
      { name: 'my-app', version: '1.0.0', path: tmpDir },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].type, 'feat');
    assert.ok(commits[0].packages.includes('my-app'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits parses non-conventional commits', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    // Add a non-conventional commit (no type: prefix)
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'index.js'),
      '// updated pkg-a'
    );
    await git.add('.');
    await git.commit('Update readme and fix typos');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].type, null);
    assert.strictEqual(commits[0].subject, null);
    assert.strictEqual(commits[0].rawMessage, 'Update readme and fix typos');
    assert.strictEqual(commits[0].breaking, false);
    assert.ok(commits[0].packages.includes('pkg-a'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits sets rawMessage for conventional commits too', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'index.js'),
      '// pkg-a feature'
    );
    await git.add('.');
    await git.commit('feat: add new feature to pkg-a');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].type, 'feat');
    assert.strictEqual(commits[0].subject, 'add new feature to pkg-a');
    assert.strictEqual(commits[0].rawMessage, 'feat: add new feature to pkg-a');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits extracts the Release-As footer', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'index.js'),
      '// pkg-a release-as'
    );
    await git.add('.');
    await git.commit('feat: ready to ship\n\nRelease-As: 2.0.0');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].releaseAs, '2.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits extracts Release-As case-insensitively', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await writeFile(join(tmpDir, 'README.md'), '# graduate');
    await git.add('.');
    await git.commit('chore: graduate prerelease\n\nrelease-as: stable');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].releaseAs, 'stable');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits prefers a valid Release-As footer over prose that begins with the keyword', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'index.js'),
      '// pkg-a shadowed'
    );
    await git.add('.');
    // Prose that starts with the keyword must NOT shadow the real footer.
    await git.commit(
      'feat: ready to ship\n\n' +
        'Release-As pins the first release, since this repo has no prior\n' +
        'release: commit to anchor on.\n\n' +
        'Release-As: 2.0.0'
    );

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].releaseAs, '2.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits has no Release-As when the footer is absent', async () => {
  const tmpDir = await setupGitRepo();
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'index.js'),
      '// pkg-a plain'
    );
    await git.add('.');
    await git.commit('feat: no footer here');

    const workspacePackages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'packages', 'pkg-a') },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].releaseAs, null);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits falls back to the latest semver tag when no release commit exists', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-git-'));
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Single-package repo whose history has a manual tag but NO release: commit
    // (the classic "migrating off manual tagging" situation).
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '1.0.0' })
    );
    await git.add('package.json');
    await git.commit('feat: pre-tag feature'); // before the tag → excluded
    await git.addTag('v1.0.0');

    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'index.ts'), 'console.log("hello")');
    await git.add('.');
    await git.commit('feat: add hello world'); // after the tag → included

    const workspacePackages = [
      { name: 'my-app', version: '1.0.0', path: tmpDir },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    // Only the commit after the tag; the entire pre-tag history is excluded.
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].subject, 'add hello world');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits analyzes all history when neither release commit nor tag exists', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-git-'));
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '0.0.0' })
    );
    await git.add('package.json');
    await git.commit('feat: first');
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'index.ts'), '// second');
    await git.add('.');
    await git.commit('feat: second');

    const workspacePackages = [
      { name: 'my-app', version: '0.0.0', path: tmpDir },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    assert.strictEqual(commits.length, 2);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('analyzeCommits recognizes flexible release commit formats', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-git-'));
  const git: SimpleGit = simpleGit(tmpDir);

  try {
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Create single package repo
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '1.0.0' })
    );
    await git.add('package.json');
    await git.commit('chore: initial commit');

    // Use "chore: release v1.0.0" format instead of "release: 1.0.0"
    await git.commit('chore: release v1.0.0', ['--allow-empty']);

    // Add commits after the release
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'index.ts'), 'console.log("hello")');
    await git.add('.');
    await git.commit('feat: add hello world');

    const workspacePackages = [
      { name: 'my-app', version: '1.0.0', path: tmpDir },
    ];

    const commits = await analyzeCommits(tmpDir, workspacePackages);

    // Should only get commits after the "chore: release v1.0.0" commit
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].type, 'feat');
    assert.strictEqual(commits[0].subject, 'add hello world');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
