// ABOUTME: Tests for Rust ecosystem adapter
// ABOUTME: Validates Cargo.toml detection, workspace discovery, version updates, and publishing

import { test } from 'node:test';
import assert from 'node:assert';
import {
  RustAdapter,
  topologicalSortCrates,
  parseCrateDependencies,
  waitForCrateIndexed,
} from './rust.js';
import type { ExecFn, WorkspacePackage } from './types.js';

const noWait = async () => {};
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const adapter = new RustAdapter();

test('detect returns true when Cargo.toml exists', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[package]\nname = "my-crate"\nversion = "1.0.0"\n'
    );
    assert.strictEqual(await adapter.detect(tmpDir), true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detect returns false when no Cargo.toml', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    assert.strictEqual(await adapter.detect(tmpDir), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverPackages finds single crate', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[package]\nname = "my-crate"\nversion = "1.2.3"\n'
    );

    const packages = await adapter.discoverPackages(tmpDir);

    assert.strictEqual(packages.length, 1);
    assert.strictEqual(packages[0].name, 'my-crate');
    assert.strictEqual(packages[0].version, '1.2.3');
    assert.strictEqual(packages[0].ecosystem, 'rust');
    assert.strictEqual(packages[0].path, tmpDir);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverPackages finds workspace members', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/*"]\n'
    );
    await mkdir(join(tmpDir, 'crates', 'crate-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      '[package]\nname = "crate-a"\nversion = "1.0.0"\n'
    );
    await mkdir(join(tmpDir, 'crates', 'crate-b'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-b', 'Cargo.toml'),
      '[package]\nname = "crate-b"\nversion = "1.0.0"\n'
    );

    const packages = await adapter.discoverPackages(tmpDir);

    assert.strictEqual(packages.length, 2);
    const names = packages.map((p) => p.name).sort();
    assert.deepStrictEqual(names, ['crate-a', 'crate-b']);
    assert.ok(packages.every((p) => p.ecosystem === 'rust'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverPackages handles workspace version inheritance', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      [
        '[workspace]',
        'members = ["crates/*"]',
        '',
        '[workspace.package]',
        'version = "2.0.0"',
        '',
      ].join('\n')
    );
    await mkdir(join(tmpDir, 'crates', 'crate-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      [
        '[package]',
        'name = "crate-a"',
        'version.workspace = true',
        '',
      ].join('\n')
    );

    const packages = await adapter.discoverPackages(tmpDir);

    assert.strictEqual(packages.length, 1);
    assert.strictEqual(packages[0].name, 'crate-a');
    assert.strictEqual(packages[0].version, '2.0.0');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateVersions updates single crate version', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    const originalContent =
      '[package]\nname = "my-crate"\nversion = "1.0.0"\nedition = "2021"\n';
    await writeFile(join(tmpDir, 'Cargo.toml'), originalContent);

    const packages = [
      {
        name: 'my-crate',
        version: '1.0.0',
        path: tmpDir,
        ecosystem: 'rust' as const,
      },
    ];

    await adapter.updateVersions(tmpDir, '2.0.0', packages);

    const updated = await readFile(join(tmpDir, 'Cargo.toml'), 'utf-8');
    assert.ok(updated.includes('version = "2.0.0"'));
    assert.ok(updated.includes('edition = "2021"'));
    assert.ok(updated.includes('name = "my-crate"'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateVersions updates workspace.package version', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      [
        '[workspace]',
        'members = ["crates/*"]',
        '',
        '[workspace.package]',
        'version = "1.0.0"',
        'edition = "2021"',
        '',
      ].join('\n')
    );
    await mkdir(join(tmpDir, 'crates', 'crate-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      [
        '[package]',
        'name = "crate-a"',
        'version.workspace = true',
        '',
      ].join('\n')
    );

    const packages = [
      {
        name: 'crate-a',
        version: '1.0.0',
        path: join(tmpDir, 'crates', 'crate-a'),
        ecosystem: 'rust' as const,
      },
    ];

    await adapter.updateVersions(tmpDir, '3.0.0', packages);

    // Root workspace version should be updated
    const rootCargo = await readFile(join(tmpDir, 'Cargo.toml'), 'utf-8');
    assert.ok(rootCargo.includes('version = "3.0.0"'));
    assert.ok(rootCargo.includes('edition = "2021"'));

    // Crate with version.workspace = true should NOT be modified
    const crateCargo = await readFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      'utf-8'
    );
    assert.ok(crateCargo.includes('version.workspace = true'));
    assert.ok(!crateCargo.includes('3.0.0'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateVersions updates explicit crate versions in workspace', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/*"]\n'
    );
    await mkdir(join(tmpDir, 'crates', 'crate-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      '[package]\nname = "crate-a"\nversion = "1.0.0"\n'
    );

    const packages = [
      {
        name: 'crate-a',
        version: '1.0.0',
        path: join(tmpDir, 'crates', 'crate-a'),
        ecosystem: 'rust' as const,
      },
    ];

    await adapter.updateVersions(tmpDir, '4.0.0', packages);

    const crateCargo = await readFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      'utf-8'
    );
    assert.ok(crateCargo.includes('version = "4.0.0"'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateVersions preserves formatting and comments', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    const originalContent = [
      '# My awesome crate',
      '[package]',
      'name = "my-crate"',
      'version = "1.0.0" # current version',
      'edition = "2021"',
      '',
      '[dependencies]',
      'serde = "1.0"',
      '',
    ].join('\n');

    await writeFile(join(tmpDir, 'Cargo.toml'), originalContent);

    const packages = [
      {
        name: 'my-crate',
        version: '1.0.0',
        path: tmpDir,
        ecosystem: 'rust' as const,
      },
    ];

    await adapter.updateVersions(tmpDir, '2.0.0', packages);

    const updated = await readFile(join(tmpDir, 'Cargo.toml'), 'utf-8');

    // Comment before the file should be preserved
    assert.ok(updated.includes('# My awesome crate'));
    // Inline comment should be preserved
    assert.ok(updated.includes('# current version'));
    // Version should be updated
    assert.ok(updated.includes('version = "2.0.0"'));
    // Other fields should be unchanged
    assert.ok(updated.includes('serde = "1.0"'));
    assert.ok(updated.includes('edition = "2021"'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateVersions ignores non-rust packages', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    // Create a Cargo.toml that should NOT be touched
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[workspace]\nmembers = []\n'
    );

    const packages = [
      {
        name: 'my-js-pkg',
        version: '1.0.0',
        path: join(tmpDir, 'js-pkg'),
        ecosystem: 'javascript' as const,
      },
    ];

    // Should not throw, even though there are no rust packages
    await adapter.updateVersions(tmpDir, '2.0.0', packages);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- isPrivate tests ---

test('isPrivate returns true for publish = false', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[package]\nname = "my-crate"\nversion = "1.0.0"\npublish = false\n'
    );
    assert.strictEqual(await adapter.isPrivate(tmpDir), true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isPrivate returns true for publish = []', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[package]\nname = "my-crate"\nversion = "1.0.0"\npublish = []\n'
    );
    assert.strictEqual(await adapter.isPrivate(tmpDir), true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isPrivate returns false for publishable crate', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[package]\nname = "my-crate"\nversion = "1.0.0"\n'
    );
    assert.strictEqual(await adapter.isPrivate(tmpDir), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isPrivate returns false when publish lists registries', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[package]\nname = "my-crate"\nversion = "1.0.0"\npublish = ["crates-io"]\n'
    );
    assert.strictEqual(await adapter.isPrivate(tmpDir), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isPrivate returns true when Cargo.toml is missing', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    assert.strictEqual(await adapter.isPrivate(tmpDir), true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- parseCrateDependencies tests ---

test('parseCrateDependencies extracts dependencies and build-dependencies', () => {
  const content = [
    '[package]',
    'name = "my-crate"',
    'version = "1.0.0"',
    '',
    '[dependencies]',
    'serde = "1.0"',
    'tokio = { version = "1", features = ["full"] }',
    '',
    '[build-dependencies]',
    'cc = "1.0"',
    '',
    '[dev-dependencies]',
    'tempfile = "3.0"',
    '',
  ].join('\n');

  const deps = parseCrateDependencies(content);
  assert.ok(deps.includes('serde'));
  assert.ok(deps.includes('tokio'));
  assert.ok(deps.includes('cc'));
  // dev-dependencies should NOT be included
  assert.ok(!deps.includes('tempfile'));
});

test('parseCrateDependencies returns empty for no deps', () => {
  const content = '[package]\nname = "my-crate"\nversion = "1.0.0"\n';
  const deps = parseCrateDependencies(content);
  assert.deepStrictEqual(deps, []);
});

// --- topologicalSortCrates tests ---

test('topologicalSortCrates sorts dependencies before dependents', () => {
  const packages: WorkspacePackage[] = [
    { name: 'app', version: '1.0.0', path: '/app', ecosystem: 'rust' },
    { name: 'core', version: '1.0.0', path: '/core', ecosystem: 'rust' },
    { name: 'utils', version: '1.0.0', path: '/utils', ecosystem: 'rust' },
  ];

  // app depends on core, core depends on utils
  const depMap = new Map([
    ['app', ['core', 'serde']], // serde is external, should be ignored
    ['core', ['utils']],
    ['utils', []],
  ]);

  const sorted = topologicalSortCrates(packages, depMap);
  const names = sorted.map((p) => p.name);

  assert.strictEqual(names.indexOf('utils') < names.indexOf('core'), true);
  assert.strictEqual(names.indexOf('core') < names.indexOf('app'), true);
});

test('topologicalSortCrates handles no internal dependencies', () => {
  const packages: WorkspacePackage[] = [
    { name: 'a', version: '1.0.0', path: '/a', ecosystem: 'rust' },
    { name: 'b', version: '1.0.0', path: '/b', ecosystem: 'rust' },
  ];

  const depMap = new Map([
    ['a', ['serde']],
    ['b', ['tokio']],
  ]);

  const sorted = topologicalSortCrates(packages, depMap);
  assert.strictEqual(sorted.length, 2);
});

test('topologicalSortCrates handles diamond dependencies', () => {
  const packages: WorkspacePackage[] = [
    { name: 'app', version: '1.0.0', path: '/app', ecosystem: 'rust' },
    { name: 'left', version: '1.0.0', path: '/left', ecosystem: 'rust' },
    { name: 'right', version: '1.0.0', path: '/right', ecosystem: 'rust' },
    { name: 'base', version: '1.0.0', path: '/base', ecosystem: 'rust' },
  ];

  // Diamond: app → left → base, app → right → base
  const depMap = new Map([
    ['app', ['left', 'right']],
    ['left', ['base']],
    ['right', ['base']],
    ['base', []],
  ]);

  const sorted = topologicalSortCrates(packages, depMap);
  const names = sorted.map((p) => p.name);

  // base must come before left and right
  assert.ok(names.indexOf('base') < names.indexOf('left'));
  assert.ok(names.indexOf('base') < names.indexOf('right'));
  // left and right must come before app
  assert.ok(names.indexOf('left') < names.indexOf('app'));
  assert.ok(names.indexOf('right') < names.indexOf('app'));
});

test('topologicalSortCrates handles single package', () => {
  const packages: WorkspacePackage[] = [
    { name: 'solo', version: '1.0.0', path: '/solo', ecosystem: 'rust' },
  ];

  const sorted = topologicalSortCrates(packages, new Map([['solo', []]]));
  assert.strictEqual(sorted.length, 1);
  assert.strictEqual(sorted[0].name, 'solo');
});

// --- publishPackages tests ---

test('publishPackages calls cargo publish -p for each crate', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    // Create Cargo.toml files for dependency resolution
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/*"]\n'
    );
    await mkdir(join(tmpDir, 'crates', 'crate-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      '[package]\nname = "crate-a"\nversion = "1.0.0"\n'
    );

    const calls: { command: string; args: string[]; cwd?: string }[] = [];
    const mockExec: ExecFn = async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
      return { stdout: '', stderr: '' };
    };

    const packages: WorkspacePackage[] = [
      { name: 'crate-a', version: '1.0.0', path: join(tmpDir, 'crates', 'crate-a'), ecosystem: 'rust' },
    ];

    const results = await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec, noWait);

    assert.strictEqual(results.length, 1);
    assert.ok(results[0].success);
    assert.strictEqual(results[0].version, '1.0.0');
    assert.strictEqual(results[0].registry, 'crates.io');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, 'cargo');
    assert.deepStrictEqual(calls[0].args, ['publish', '-p', 'crate-a']);
    assert.strictEqual(calls[0].cwd, tmpDir);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('publishPackages publishes in topological order', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/*"]\n'
    );

    // crate-app depends on crate-lib
    await mkdir(join(tmpDir, 'crates', 'crate-app'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-app', 'Cargo.toml'),
      [
        '[package]',
        'name = "crate-app"',
        'version = "1.0.0"',
        '',
        '[dependencies]',
        'crate-lib = { path = "../crate-lib" }',
        '',
      ].join('\n')
    );

    await mkdir(join(tmpDir, 'crates', 'crate-lib'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-lib', 'Cargo.toml'),
      '[package]\nname = "crate-lib"\nversion = "1.0.0"\n'
    );

    const publishOrder: string[] = [];
    const mockExec: ExecFn = async (_command, args) => {
      // Extract crate name from `cargo publish -p <name>`
      publishOrder.push(args[2]);
      return { stdout: '', stderr: '' };
    };

    const packages: WorkspacePackage[] = [
      { name: 'crate-app', version: '1.0.0', path: join(tmpDir, 'crates', 'crate-app'), ecosystem: 'rust' },
      { name: 'crate-lib', version: '1.0.0', path: join(tmpDir, 'crates', 'crate-lib'), ecosystem: 'rust' },
    ];

    await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec, noWait);

    // crate-lib should be published before crate-app
    assert.deepStrictEqual(publishOrder, ['crate-lib', 'crate-app']);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('publishPackages fails fast on error', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/*"]\n'
    );
    await mkdir(join(tmpDir, 'crates', 'crate-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      '[package]\nname = "crate-a"\nversion = "1.0.0"\n'
    );
    await mkdir(join(tmpDir, 'crates', 'crate-b'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-b', 'Cargo.toml'),
      '[package]\nname = "crate-b"\nversion = "1.0.0"\n'
    );

    let callCount = 0;
    const mockExec: ExecFn = async () => {
      callCount++;
      if (callCount === 1) throw new Error('cargo publish failed');
      return { stdout: '', stderr: '' };
    };

    const packages: WorkspacePackage[] = [
      { name: 'crate-a', version: '1.0.0', path: join(tmpDir, 'crates', 'crate-a'), ecosystem: 'rust' },
      { name: 'crate-b', version: '1.0.0', path: join(tmpDir, 'crates', 'crate-b'), ecosystem: 'rust' },
    ];

    const results = await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec, noWait);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
    assert.ok(results[0].error?.includes('cargo publish failed'));
    assert.strictEqual(callCount, 1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('publishPackages filters out non-rust packages', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    const calls: string[] = [];
    const mockExec: ExecFn = async (_command, args) => {
      calls.push(args[2]);
      return { stdout: '', stderr: '' };
    };

    const packages: WorkspacePackage[] = [
      { name: 'my-js-pkg', version: '1.0.0', path: '/js', ecosystem: 'javascript' },
    ];

    const results = await adapter.publishPackages(tmpDir, '1.0.0', packages, mockExec, noWait);

    assert.deepStrictEqual(results, []);
    assert.strictEqual(calls.length, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('publishPackages waits for index between publishes', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-rust-'));
  try {
    await writeFile(
      join(tmpDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/*"]\n'
    );
    await mkdir(join(tmpDir, 'crates', 'crate-a'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-a', 'Cargo.toml'),
      '[package]\nname = "crate-a"\nversion = "1.0.0"\n'
    );
    await mkdir(join(tmpDir, 'crates', 'crate-b'), { recursive: true });
    await writeFile(
      join(tmpDir, 'crates', 'crate-b', 'Cargo.toml'),
      '[package]\nname = "crate-b"\nversion = "1.0.0"\n'
    );

    const timeline: string[] = [];
    const mockExec: ExecFn = async (_cmd, args) => {
      timeline.push(`publish:${args[2]}`);
      return { stdout: '', stderr: '' };
    };
    const mockWait = async (name: string, version: string) => {
      timeline.push(`wait:${name}@${version}`);
    };

    const packages: WorkspacePackage[] = [
      { name: 'crate-a', version: '1.0.0', path: join(tmpDir, 'crates', 'crate-a'), ecosystem: 'rust' },
      { name: 'crate-b', version: '1.0.0', path: join(tmpDir, 'crates', 'crate-b'), ecosystem: 'rust' },
    ];

    await adapter.publishPackages(tmpDir, '2.0.0', packages, mockExec, mockWait);

    // First crate published, then wait for it to index, then second crate
    assert.strictEqual(timeline[0], 'publish:crate-a');
    assert.strictEqual(timeline[1], 'wait:crate-a@2.0.0');
    assert.strictEqual(timeline[2], 'publish:crate-b');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- waitForCrateIndexed tests ---

test('waitForCrateIndexed returns immediately when API responds 200', async () => {
  const mockFetch = async () =>
    ({ ok: true, status: 200 }) as Response;

  // Should resolve without throwing
  await waitForCrateIndexed('my-crate', '1.0.0', mockFetch);
});

test('waitForCrateIndexed retries on 404 then succeeds on 200', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    if (callCount < 3) {
      return { ok: false, status: 404 } as Response;
    }
    return { ok: true, status: 200 } as Response;
  };

  await waitForCrateIndexed('my-crate', '1.0.0', mockFetch);
  assert.strictEqual(callCount, 3);
});

test('waitForCrateIndexed retries on network error', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    if (callCount < 2) {
      throw new Error('network error');
    }
    return { ok: true, status: 200 } as Response;
  };

  await waitForCrateIndexed('my-crate', '1.0.0', mockFetch);
  assert.strictEqual(callCount, 2);
});
