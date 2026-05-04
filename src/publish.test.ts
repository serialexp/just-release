// ABOUTME: Tests for publish orchestrator
// ABOUTME: Validates cross-ecosystem publish coordination, prerequisite gating, and failure handling

import { test } from 'node:test';
import assert from 'node:assert';
import { publishAllPackages, hasPublishFailures } from './publish.js';
import type {
  EcosystemAdapter,
  WorkspacePackage,
  ExecFn,
  PublishPrerequisiteResult,
  PublishResult,
} from './ecosystems/types.js';

function createMockAdapter(
  overrides: Partial<EcosystemAdapter> & Pick<EcosystemAdapter, 'type' | 'displayName'>
): EcosystemAdapter {
  return {
    manifestFileName: 'mock',
    detect: async () => true,
    discoverPackages: async () => [],
    updateVersions: async () => {},
    isPrivate: async () => false,
    checkPublishPrerequisites: async () => ({ ready: true }),
    publishPackages: async () => [],
    ...overrides,
  };
}

test('publishAllPackages skips Go adapter entirely', async () => {
  const goAdapter = createMockAdapter({
    type: 'go',
    displayName: 'Go',
    publishPackages: async () => {
      throw new Error('should not be called');
    },
  });

  const summaries = await publishAllPackages('/root', '1.0.0', [], [goAdapter]);
  assert.strictEqual(summaries.length, 0);
});

test('publishAllPackages skips ecosystem when prerequisites not met', async () => {
  const jsAdapter = createMockAdapter({
    type: 'javascript',
    displayName: 'JavaScript',
    checkPublishPrerequisites: async () => ({
      ready: false,
      reason: 'pnpm is not installed',
    }),
  });

  const summaries = await publishAllPackages('/root', '1.0.0', [], [jsAdapter]);

  assert.strictEqual(summaries.length, 1);
  assert.strictEqual(summaries[0].skipped, true);
  assert.strictEqual(summaries[0].skipReason, 'pnpm is not installed');
});

test('publishAllPackages filters out private packages', async () => {
  const publishedNames: string[] = [];
  const jsAdapter = createMockAdapter({
    type: 'javascript',
    displayName: 'JavaScript',
    isPrivate: async (path: string) => path.includes('private'),
    publishPackages: async (_root, _version, pkgs) => {
      for (const p of pkgs) publishedNames.push(p.name);
      return pkgs.map((p) => ({ packageName: p.name, success: true }));
    },
  });

  const packages: WorkspacePackage[] = [
    { name: 'public-pkg', version: '1.0.0', path: '/public', ecosystem: 'javascript' },
    { name: 'private-pkg', version: '1.0.0', path: '/private', ecosystem: 'javascript' },
  ];

  const summaries = await publishAllPackages('/root', '1.0.0', packages, [jsAdapter]);

  assert.strictEqual(summaries.length, 1);
  assert.strictEqual(summaries[0].skipped, false);
  assert.deepStrictEqual(publishedNames, ['public-pkg']);
});

test('publishAllPackages skips when all packages are private', async () => {
  const jsAdapter = createMockAdapter({
    type: 'javascript',
    displayName: 'JavaScript',
    isPrivate: async () => true,
  });

  const packages: WorkspacePackage[] = [
    { name: 'private-1', version: '1.0.0', path: '/p1', ecosystem: 'javascript' },
    { name: 'private-2', version: '1.0.0', path: '/p2', ecosystem: 'javascript' },
  ];

  const summaries = await publishAllPackages('/root', '1.0.0', packages, [jsAdapter]);

  assert.strictEqual(summaries.length, 1);
  assert.strictEqual(summaries[0].skipped, true);
  assert.ok(summaries[0].skipReason?.includes('private'));
});

test('publishAllPackages continues across ecosystems on failure', async () => {
  const jsAdapter = createMockAdapter({
    type: 'javascript',
    displayName: 'JavaScript',
    publishPackages: async () => [
      { packageName: 'js-pkg', success: false, error: 'publish failed' },
    ],
  });

  const rustAdapter = createMockAdapter({
    type: 'rust',
    displayName: 'Rust',
    publishPackages: async () => [
      { packageName: 'rs-crate', success: true },
    ],
  });

  const packages: WorkspacePackage[] = [
    { name: 'js-pkg', version: '1.0.0', path: '/js', ecosystem: 'javascript' },
    { name: 'rs-crate', version: '1.0.0', path: '/rs', ecosystem: 'rust' },
  ];

  const summaries = await publishAllPackages(
    '/root',
    '1.0.0',
    packages,
    [jsAdapter, rustAdapter]
  );

  assert.strictEqual(summaries.length, 2);
  // JS failed
  assert.strictEqual(summaries[0].results[0].success, false);
  // Rust still succeeded
  assert.strictEqual(summaries[1].results[0].success, true);
});

test('publishAllPackages passes exec function through', async () => {
  let execWasCalled = false;
  const mockExec: ExecFn = async () => {
    execWasCalled = true;
    return { stdout: '', stderr: '' };
  };

  const jsAdapter = createMockAdapter({
    type: 'javascript',
    displayName: 'JavaScript',
    publishPackages: async (_root, _version, _pkgs, exec) => {
      if (exec) await exec('test', [], {});
      return [];
    },
  });

  const packages: WorkspacePackage[] = [
    { name: 'pkg', version: '1.0.0', path: '/pkg', ecosystem: 'javascript' },
  ];

  await publishAllPackages('/root', '1.0.0', packages, [jsAdapter], mockExec);
  assert.strictEqual(execWasCalled, true);
});

test('hasPublishFailures returns false when all succeed', () => {
  assert.strictEqual(
    hasPublishFailures([
      {
        ecosystem: 'JavaScript',
        skipped: false,
        results: [{ packageName: 'pkg', success: true }],
      },
    ]),
    false
  );
});

test('hasPublishFailures returns true when any fail', () => {
  assert.strictEqual(
    hasPublishFailures([
      {
        ecosystem: 'JavaScript',
        skipped: false,
        results: [{ packageName: 'pkg', success: false, error: 'failed' }],
      },
    ]),
    true
  );
});

test('hasPublishFailures returns false for skipped ecosystems', () => {
  assert.strictEqual(
    hasPublishFailures([
      {
        ecosystem: 'JavaScript',
        skipped: true,
        skipReason: 'no token',
        results: [],
      },
    ]),
    false
  );
});
