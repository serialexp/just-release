// ABOUTME: Tests for JavaScript ecosystem adapter
// ABOUTME: Validates package.json detection, workspace discovery, version updates, and publishing

import { test } from 'node:test';
import assert from 'node:assert';
import {
  JavaScriptAdapter,
  detectJsPackageManager,
  getPublishCommand,
  checkProvenanceSupport,
  extractGitHubRepo,
} from './javascript.js';
import type { ExecFn } from './types.js';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const adapter = new JavaScriptAdapter();

test('detect returns true when package.json exists', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' })
    );
    assert.strictEqual(await adapter.detect(tmpDir), true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detect returns false when no package.json', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    assert.strictEqual(await adapter.detect(tmpDir), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverPackages finds pnpm workspace packages', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
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

    const packages = await adapter.discoverPackages(tmpDir);

    assert.strictEqual(packages.length, 1);
    assert.strictEqual(packages[0].name, 'pkg-a');
    assert.strictEqual(packages[0].ecosystem, 'javascript');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverPackages finds npm workspace packages', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        version: '2.0.0',
        workspaces: ['packages/*'],
      })
    );
    await mkdir(join(tmpDir, 'packages', 'pkg-b'), { recursive: true });
    await writeFile(
      join(tmpDir, 'packages', 'pkg-b', 'package.json'),
      JSON.stringify({ name: 'pkg-b', version: '2.0.0' })
    );

    const packages = await adapter.discoverPackages(tmpDir);

    assert.strictEqual(packages.length, 1);
    assert.strictEqual(packages[0].name, 'pkg-b');
    assert.strictEqual(packages[0].ecosystem, 'javascript');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverPackages falls back to root package', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-package', version: '3.0.0' })
    );

    const packages = await adapter.discoverPackages(tmpDir);

    assert.strictEqual(packages.length, 1);
    assert.strictEqual(packages[0].name, 'my-package');
    assert.strictEqual(packages[0].path, tmpDir);
    assert.strictEqual(packages[0].ecosystem, 'javascript');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateVersions writes new version to all package.json files', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }, null, 2)
    );
    await mkdir(join(tmpDir, 'packages', 'pkg-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'packages', 'pkg-a', 'package.json'),
      JSON.stringify({ name: 'pkg-a', version: '1.0.0' }, null, 2)
    );

    const packages = [
      {
        name: 'pkg-a',
        version: '1.0.0',
        path: join(tmpDir, 'packages', 'pkg-a'),
        ecosystem: 'javascript' as const,
      },
    ];

    await adapter.updateVersions(tmpDir, '2.0.0', packages);

    const rootPkg = JSON.parse(
      await readFile(join(tmpDir, 'package.json'), 'utf-8')
    );
    assert.strictEqual(rootPkg.version, '2.0.0');

    const pkgA = JSON.parse(
      await readFile(
        join(tmpDir, 'packages', 'pkg-a', 'package.json'),
        'utf-8'
      )
    );
    assert.strictEqual(pkgA.version, '2.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateVersions ignores non-javascript packages', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }, null, 2)
    );

    const packages = [
      {
        name: 'my-crate',
        version: '1.0.0',
        path: join(tmpDir, 'crates', 'my-crate'),
        ecosystem: 'rust' as const,
      },
    ];

    // Should not throw even though the rust crate path doesn't exist
    await adapter.updateVersions(tmpDir, '2.0.0', packages);

    const rootPkg = JSON.parse(
      await readFile(join(tmpDir, 'package.json'), 'utf-8')
    );
    assert.strictEqual(rootPkg.version, '2.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- isPrivate tests ---

test('isPrivate returns true for private packages', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-private-pkg', private: true })
    );
    assert.strictEqual(await adapter.isPrivate(tmpDir), true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isPrivate returns false for public packages', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-public-pkg', version: '1.0.0' })
    );
    assert.strictEqual(await adapter.isPrivate(tmpDir), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isPrivate returns false when private is explicitly false', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-pkg', private: false })
    );
    assert.strictEqual(await adapter.isPrivate(tmpDir), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isPrivate returns true when package.json is missing', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    assert.strictEqual(await adapter.isPrivate(tmpDir), true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- detectJsPackageManager tests ---

test('detectJsPackageManager detects pnpm from lockfile', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(join(tmpDir, 'pnpm-lock.yaml'), '');
    assert.strictEqual(await detectJsPackageManager(tmpDir), 'pnpm');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectJsPackageManager detects yarn from lockfile', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(join(tmpDir, 'yarn.lock'), '');
    assert.strictEqual(await detectJsPackageManager(tmpDir), 'yarn');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectJsPackageManager defaults to npm', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    assert.strictEqual(await detectJsPackageManager(tmpDir), 'npm');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectJsPackageManager prefers pnpm over yarn', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(join(tmpDir, 'pnpm-lock.yaml'), '');
    await writeFile(join(tmpDir, 'yarn.lock'), '');
    assert.strictEqual(await detectJsPackageManager(tmpDir), 'pnpm');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- getPublishCommand tests ---

test('getPublishCommand returns correct pnpm command', () => {
  const { command, args } = getPublishCommand('pnpm');
  assert.strictEqual(command, 'pnpm');
  assert.deepStrictEqual(args, ['publish', '--no-git-checks', '--access', 'public']);
});

test('getPublishCommand returns correct pnpm command with provenance', () => {
  const { command, args } = getPublishCommand('pnpm', true);
  assert.strictEqual(command, 'pnpm');
  assert.deepStrictEqual(args, ['publish', '--no-git-checks', '--access', 'public', '--provenance']);
});

test('getPublishCommand returns correct yarn command', () => {
  const { command, args } = getPublishCommand('yarn');
  assert.strictEqual(command, 'yarn');
  assert.deepStrictEqual(args, ['npm', 'publish', '--access', 'public']);
});

test('getPublishCommand returns correct yarn command ignores provenance', () => {
  const { command, args } = getPublishCommand('yarn', true);
  assert.strictEqual(command, 'yarn');
  assert.deepStrictEqual(args, ['npm', 'publish', '--access', 'public']);
});

test('getPublishCommand returns correct npm command', () => {
  const { command, args } = getPublishCommand('npm');
  assert.strictEqual(command, 'npm');
  assert.deepStrictEqual(args, ['publish', '--access', 'public']);
});

test('getPublishCommand returns correct npm command with provenance', () => {
  const { command, args } = getPublishCommand('npm', true);
  assert.strictEqual(command, 'npm');
  assert.deepStrictEqual(args, ['publish', '--access', 'public', '--provenance']);
});

// --- publishPackages tests ---

test('publishPackages calls exec with correct command for each package', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    // Create pnpm lockfile so pnpm is detected
    await writeFile(join(tmpDir, 'pnpm-lock.yaml'), '');

    // Create package dirs with package.json (no repository field → no provenance)
    await mkdir(join(tmpDir, 'a'), { recursive: true });
    await mkdir(join(tmpDir, 'b'), { recursive: true });
    await writeFile(join(tmpDir, 'a', 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.0.0' }));
    await writeFile(join(tmpDir, 'b', 'package.json'), JSON.stringify({ name: 'pkg-b', version: '1.0.0' }));

    const calls: { command: string; args: string[]; cwd?: string }[] = [];
    const mockExec: ExecFn = async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
      return { stdout: '', stderr: '' };
    };

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'a'), ecosystem: 'javascript' as const },
      { name: 'pkg-b', version: '1.0.0', path: join(tmpDir, 'b'), ecosystem: 'javascript' as const },
    ];

    const results = await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec);

    assert.strictEqual(results.length, 2);
    assert.ok(results.every((r) => r.success));
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].command, 'pnpm');
    assert.deepStrictEqual(calls[0].args, ['publish', '--no-git-checks', '--access', 'public']);
    assert.strictEqual(calls[0].cwd, join(tmpDir, 'a'));
    assert.strictEqual(calls[1].cwd, join(tmpDir, 'b'));
    // Should have warnings about missing repository field
    assert.ok(results[0].warnings && results[0].warnings.length > 0);
    assert.ok(results[0].warnings![0].includes('repository'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('publishPackages filters out non-javascript packages', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await mkdir(join(tmpDir, 'js'), { recursive: true });
    await writeFile(join(tmpDir, 'js', 'package.json'), JSON.stringify({ name: 'js-pkg', version: '1.0.0' }));

    const calls: string[] = [];
    const mockExec: ExecFn = async (_command, _args, options) => {
      calls.push(options?.cwd || '');
      return { stdout: '', stderr: '' };
    };

    const packages = [
      { name: 'js-pkg', version: '1.0.0', path: join(tmpDir, 'js'), ecosystem: 'javascript' as const },
      { name: 'rs-pkg', version: '1.0.0', path: join(tmpDir, 'rs'), ecosystem: 'rust' as const },
    ];

    const results = await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].packageName, 'js-pkg');
    assert.strictEqual(calls.length, 1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('publishPackages fails fast on error', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await mkdir(join(tmpDir, 'a'), { recursive: true });
    await mkdir(join(tmpDir, 'b'), { recursive: true });
    await writeFile(join(tmpDir, 'a', 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.0.0' }));
    await writeFile(join(tmpDir, 'b', 'package.json'), JSON.stringify({ name: 'pkg-b', version: '1.0.0' }));

    let callCount = 0;
    const mockExec: ExecFn = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('publish failed');
      }
      return { stdout: '', stderr: '' };
    };

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'a'), ecosystem: 'javascript' as const },
      { name: 'pkg-b', version: '1.0.0', path: join(tmpDir, 'b'), ecosystem: 'javascript' as const },
    ];

    const results = await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
    assert.ok(results[0].error?.includes('publish failed'));
    assert.strictEqual(callCount, 1); // Second package was NOT attempted
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('publishPackages uses npm command when no lockfile present', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    // Create package dir with package.json (no repository → no provenance)
    await mkdir(join(tmpDir, 'a'), { recursive: true });
    await writeFile(join(tmpDir, 'a', 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.0.0' }));

    const calls: { command: string; args: string[] }[] = [];
    const mockExec: ExecFn = async (command, args) => {
      calls.push({ command, args });
      return { stdout: '', stderr: '' };
    };

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'a'), ecosystem: 'javascript' as const },
    ];

    await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec);

    assert.strictEqual(calls[0].command, 'npm');
    assert.deepStrictEqual(calls[0].args, ['publish', '--access', 'public']);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- checkProvenanceSupport tests ---

test('checkProvenanceSupport returns supported when package has repository field', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'my-pkg',
      version: '1.0.0',
      repository: { type: 'git', url: 'https://github.com/foo/bar' },
    }));
    const result = await checkProvenanceSupport(tmpDir, 'pnpm');
    assert.strictEqual(result.supported, true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('checkProvenanceSupport returns unsupported when repository field is missing', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'my-pkg',
      version: '1.0.0',
    }));
    const result = await checkProvenanceSupport(tmpDir, 'npm');
    assert.strictEqual(result.supported, false);
    assert.ok(result.reason?.includes('repository'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('checkProvenanceSupport returns unsupported for yarn', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'my-pkg',
      version: '1.0.0',
      repository: { type: 'git', url: 'https://github.com/foo/bar' },
    }));
    const result = await checkProvenanceSupport(tmpDir, 'yarn');
    assert.strictEqual(result.supported, false);
    assert.ok(result.reason?.includes('yarn'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('publishPackages uses --provenance when package has repository field', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  try {
    await writeFile(join(tmpDir, 'pnpm-lock.yaml'), '');
    await mkdir(join(tmpDir, 'a'), { recursive: true });
    await writeFile(join(tmpDir, 'a', 'package.json'), JSON.stringify({
      name: 'pkg-a',
      version: '1.0.0',
      repository: { type: 'git', url: 'https://github.com/foo/bar' },
    }));

    const calls: { command: string; args: string[] }[] = [];
    const mockExec: ExecFn = async (command, args) => {
      calls.push({ command, args });
      return { stdout: '', stderr: '' };
    };

    const packages = [
      { name: 'pkg-a', version: '1.0.0', path: join(tmpDir, 'a'), ecosystem: 'javascript' as const },
    ];

    const results = await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec);

    assert.strictEqual(results.length, 1);
    assert.ok(results[0].success);
    assert.strictEqual(results[0].warnings, undefined);
    assert.deepStrictEqual(calls[0].args, ['publish', '--no-git-checks', '--access', 'public', '--provenance']);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- extractGitHubRepo tests ---

test('extractGitHubRepo parses HTTPS URL in object form', () => {
  assert.strictEqual(
    extractGitHubRepo({ type: 'git', url: 'https://github.com/foo/bar' }),
    'foo/bar'
  );
});

test('extractGitHubRepo parses HTTPS URL with .git suffix', () => {
  assert.strictEqual(
    extractGitHubRepo({ url: 'https://github.com/foo/bar.git' }),
    'foo/bar'
  );
});

test('extractGitHubRepo parses SSH URL', () => {
  assert.strictEqual(
    extractGitHubRepo('git@github.com:foo/bar.git'),
    'foo/bar'
  );
});

test('extractGitHubRepo parses github: shorthand', () => {
  assert.strictEqual(extractGitHubRepo('github:foo/bar'), 'foo/bar');
});

test('extractGitHubRepo parses bare owner/repo shorthand', () => {
  assert.strictEqual(extractGitHubRepo('foo/bar'), 'foo/bar');
});

test('extractGitHubRepo returns null for non-GitHub URL', () => {
  assert.strictEqual(
    extractGitHubRepo({ url: 'https://gitlab.com/foo/bar' }),
    null
  );
});

test('extractGitHubRepo returns null for null/undefined', () => {
  assert.strictEqual(extractGitHubRepo(null), null);
  assert.strictEqual(extractGitHubRepo(undefined), null);
});

// --- checkProvenanceSupport with GITHUB_REPOSITORY ---

test('checkProvenanceSupport succeeds when repository matches GITHUB_REPOSITORY', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  const prev = process.env.GITHUB_REPOSITORY;
  try {
    process.env.GITHUB_REPOSITORY = 'foo/bar';
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'my-pkg',
      repository: { type: 'git', url: 'https://github.com/foo/bar' },
    }));
    const result = await checkProvenanceSupport(tmpDir, 'pnpm');
    assert.strictEqual(result.supported, true);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = prev;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('checkProvenanceSupport fails when repository does not match GITHUB_REPOSITORY', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  const prev = process.env.GITHUB_REPOSITORY;
  try {
    process.env.GITHUB_REPOSITORY = 'other-org/other-repo';
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'my-pkg',
      repository: { type: 'git', url: 'https://github.com/foo/bar' },
    }));
    const result = await checkProvenanceSupport(tmpDir, 'npm');
    assert.strictEqual(result.supported, false);
    assert.ok(result.reason?.includes('foo/bar'));
    assert.ok(result.reason?.includes('other-org/other-repo'));
  } finally {
    if (prev === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = prev;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('checkProvenanceSupport fails when repository is non-GitHub URL in CI', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  const prev = process.env.GITHUB_REPOSITORY;
  try {
    process.env.GITHUB_REPOSITORY = 'foo/bar';
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'my-pkg',
      repository: { url: 'https://gitlab.com/foo/bar' },
    }));
    const result = await checkProvenanceSupport(tmpDir, 'pnpm');
    assert.strictEqual(result.supported, false);
    assert.ok(result.reason?.includes('does not point to a GitHub repo'));
  } finally {
    if (prev === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = prev;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('checkProvenanceSupport is case-sensitive', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-js-'));
  const prev = process.env.GITHUB_REPOSITORY;
  try {
    process.env.GITHUB_REPOSITORY = 'Foo/Bar';
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'my-pkg',
      repository: { url: 'https://github.com/foo/bar' },
    }));
    const result = await checkProvenanceSupport(tmpDir, 'npm');
    assert.strictEqual(result.supported, false);
    assert.ok(result.reason?.includes('foo/bar'));
    assert.ok(result.reason?.includes('Foo/Bar'));
  } finally {
    if (prev === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = prev;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverPackages picks up NAPI sub-packages from npm/<target>/package.json', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-napi-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] }),
    );
    await mkdir(join(tmpDir, 'packages', 'native', 'npm', 'darwin-x64'), { recursive: true });
    await mkdir(join(tmpDir, 'packages', 'native', 'npm', 'linux-x64-gnu'), { recursive: true });
    await writeFile(
      join(tmpDir, 'packages', 'native', 'package.json'),
      JSON.stringify({
        name: 'my-native',
        version: '1.0.0',
        napi: { binaryName: 'my-native', targets: ['x86_64-apple-darwin', 'x86_64-unknown-linux-gnu'] },
      }),
    );
    await writeFile(
      join(tmpDir, 'packages', 'native', 'npm', 'darwin-x64', 'package.json'),
      JSON.stringify({ name: 'my-native-darwin-x64', version: '1.0.0' }),
    );
    await writeFile(
      join(tmpDir, 'packages', 'native', 'npm', 'linux-x64-gnu', 'package.json'),
      JSON.stringify({ name: 'my-native-linux-x64-gnu', version: '1.0.0' }),
    );

    const packages = await adapter.discoverPackages(tmpDir);
    const names = packages.map((p) => p.name).sort();
    assert.deepStrictEqual(names, [
      'my-native',
      'my-native-darwin-x64',
      'my-native-linux-x64-gnu',
    ]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverPackages skips workspace packages without napi config', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-no-napi-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] }),
    );
    await mkdir(join(tmpDir, 'packages', 'plain', 'npm', 'darwin-x64'), { recursive: true });
    await writeFile(
      join(tmpDir, 'packages', 'plain', 'package.json'),
      JSON.stringify({ name: 'plain', version: '1.0.0' }),
    );
    // npm/ dir exists but no napi config: must NOT be picked up.
    await writeFile(
      join(tmpDir, 'packages', 'plain', 'npm', 'darwin-x64', 'package.json'),
      JSON.stringify({ name: 'plain-darwin-x64', version: '1.0.0' }),
    );

    const packages = await adapter.discoverPackages(tmpDir);
    assert.deepStrictEqual(
      packages.map((p) => p.name).sort(),
      ['plain'],
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateVersions rewrites cross-package deps to new version', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-deps-'));
  try {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        workspaces: ['packages/*'],
        optionalDependencies: { 'pkg-a': '1.0.0', 'pkg-b': '1.0.0', lodash: '^4.0.0' },
      }),
    );
    await mkdir(join(tmpDir, 'packages', 'a'), { recursive: true });
    await mkdir(join(tmpDir, 'packages', 'b'), { recursive: true });
    await writeFile(
      join(tmpDir, 'packages', 'a', 'package.json'),
      JSON.stringify({ name: 'pkg-a', version: '1.0.0' }),
    );
    await writeFile(
      join(tmpDir, 'packages', 'b', 'package.json'),
      JSON.stringify({
        name: 'pkg-b',
        version: '1.0.0',
        dependencies: { 'pkg-a': '1.0.0', external: '^2.0.0' },
        peerDependencies: { 'pkg-a': 'workspace:*' },
      }),
    );

    const packages = await adapter.discoverPackages(tmpDir);
    await adapter.updateVersions(tmpDir, '2.0.0', packages);

    const root = JSON.parse(await readFile(join(tmpDir, 'package.json'), 'utf-8'));
    assert.strictEqual(root.version, '2.0.0');
    assert.strictEqual(root.optionalDependencies['pkg-a'], '2.0.0');
    assert.strictEqual(root.optionalDependencies['pkg-b'], '2.0.0');
    assert.strictEqual(root.optionalDependencies.lodash, '^4.0.0');

    const b = JSON.parse(await readFile(join(tmpDir, 'packages', 'b', 'package.json'), 'utf-8'));
    assert.strictEqual(b.version, '2.0.0');
    assert.strictEqual(b.dependencies['pkg-a'], '2.0.0');
    assert.strictEqual(b.dependencies.external, '^2.0.0');
    // workspace: protocol should be left alone
    assert.strictEqual(b.peerDependencies['pkg-a'], 'workspace:*');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
