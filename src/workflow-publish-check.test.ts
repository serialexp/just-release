// ABOUTME: Tests for workflow publish step detection
// ABOUTME: Validates that just-release detects external publish commands in GitHub Actions workflows

import { test } from 'node:test';
import assert from 'node:assert';
import { detectWorkflowPublishSteps } from './workflow-publish-check.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function withTempWorkflow(
  workflowContent: string,
  fn: (cwd: string, env: Record<string, string>) => Promise<void>
) {
  const cwd = join(tmpdir(), `wf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const workflowDir = join(cwd, '.github', 'workflows');
  await mkdir(workflowDir, { recursive: true });
  await writeFile(join(workflowDir, 'release.yml'), workflowContent);

  const env: Record<string, string> = {
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/release.yml@refs/heads/main',
  };

  try {
    await fn(cwd, env);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('returns no match when not in GitHub Actions', async () => {
  const result = await detectWorkflowPublishSteps('/tmp', {});
  assert.strictEqual(result.hasExternalPublish, false);
  assert.strictEqual(result.matches.length, 0);
});

test('returns no match when GITHUB_WORKFLOW_REF is missing', async () => {
  const result = await detectWorkflowPublishSteps('/tmp', { GITHUB_ACTIONS: 'true' });
  assert.strictEqual(result.hasExternalPublish, false);
});

test('returns no match when workflow file does not exist', async () => {
  const result = await detectWorkflowPublishSteps('/tmp/nonexistent', {
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/release.yml@refs/heads/main',
  });
  assert.strictEqual(result.hasExternalPublish, false);
});

test('detects npm publish', async () => {
  await withTempWorkflow(
    `
jobs:
  release:
    steps:
      - run: npm publish --access public
`,
    async (cwd, env) => {
      const result = await detectWorkflowPublishSteps(cwd, env);
      assert.strictEqual(result.hasExternalPublish, true);
      assert.ok(result.matches.some((m) => m.includes('npm publish')));
    }
  );
});

test('detects pnpm publish', async () => {
  await withTempWorkflow(
    `
jobs:
  release:
    steps:
      - run: pnpm publish --no-git-checks
`,
    async (cwd, env) => {
      const result = await detectWorkflowPublishSteps(cwd, env);
      assert.strictEqual(result.hasExternalPublish, true);
      assert.ok(result.matches.some((m) => m.includes('pnpm publish')));
    }
  );
});

test('detects yarn npm publish', async () => {
  await withTempWorkflow(
    `
jobs:
  release:
    steps:
      - run: yarn npm publish --access public
`,
    async (cwd, env) => {
      const result = await detectWorkflowPublishSteps(cwd, env);
      assert.strictEqual(result.hasExternalPublish, true);
      assert.ok(result.matches.some((m) => m.includes('yarn npm publish')));
    }
  );
});

test('detects cargo publish', async () => {
  await withTempWorkflow(
    `
jobs:
  release:
    steps:
      - run: cargo publish -p my-crate
`,
    async (cwd, env) => {
      const result = await detectWorkflowPublishSteps(cwd, env);
      assert.strictEqual(result.hasExternalPublish, true);
      assert.ok(result.matches.some((m) => m.includes('cargo publish')));
    }
  );
});

test('ignores publish commands on just-release lines', async () => {
  await withTempWorkflow(
    `
jobs:
  release:
    steps:
      - run: npx just-release
`,
    async (cwd, env) => {
      const result = await detectWorkflowPublishSteps(cwd, env);
      assert.strictEqual(result.hasExternalPublish, false);
    }
  );
});

test('detects multiple publish commands', async () => {
  await withTempWorkflow(
    `
jobs:
  release:
    steps:
      - run: npm publish --access public
      - run: cargo publish -p my-crate
`,
    async (cwd, env) => {
      const result = await detectWorkflowPublishSteps(cwd, env);
      assert.strictEqual(result.hasExternalPublish, true);
      assert.strictEqual(result.matches.length, 2);
    }
  );
});

test('returns no match for workflow without publish steps', async () => {
  await withTempWorkflow(
    `
jobs:
  release:
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm test
`,
    async (cwd, env) => {
      const result = await detectWorkflowPublishSteps(cwd, env);
      assert.strictEqual(result.hasExternalPublish, false);
    }
  );
});

test('handles workflow ref without @ symbol', async () => {
  const cwd = join(tmpdir(), `wf-test-${Date.now()}`);
  const workflowDir = join(cwd, '.github', 'workflows');
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    join(workflowDir, 'release.yml'),
    'jobs:\n  build:\n    steps:\n      - run: npm publish\n'
  );

  try {
    const result = await detectWorkflowPublishSteps(cwd, {
      GITHUB_ACTIONS: 'true',
      GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/release.yml',
    });
    assert.strictEqual(result.hasExternalPublish, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
