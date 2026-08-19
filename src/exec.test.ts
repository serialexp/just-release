// ABOUTME: Tests for shell execution utilities
// ABOUTME: Validates defaultExec and binaryExists behavior

import { test } from 'node:test';
import assert from 'node:assert';
import { defaultExec, binaryExists, ExecError, formatExecError } from './exec.js';

test('defaultExec runs a command and returns stdout', async () => {
  const result = await defaultExec('echo', ['hello']);
  assert.strictEqual(result.stdout.trim(), 'hello');
});

test('defaultExec respects cwd option', async () => {
  const result = await defaultExec('pwd', [], { cwd: '/tmp' });
  // /tmp may resolve to /private/tmp on macOS
  assert.ok(result.stdout.trim().endsWith('/tmp'));
});

test('defaultExec rejects on command failure', async () => {
  await assert.rejects(
    () => defaultExec('false', []),
    (err: Error) => err !== undefined
  );
});

test('defaultExec throws ExecError capturing exit code, stdout, and stderr', async () => {
  await assert.rejects(
    defaultExec('node', [
      '-e',
      'process.stdout.write("OUT-LINE"); process.stderr.write("ERR-LINE"); process.exit(3)',
    ]),
    (err: unknown) => {
      assert.ok(err instanceof ExecError);
      assert.strictEqual(err.exitCode, 3);
      assert.strictEqual(err.stdout, 'OUT-LINE');
      assert.strictEqual(err.stderr, 'ERR-LINE');
      // Everything is folded into the message, uncut.
      assert.match(err.message, /exited with code 3/);
      assert.match(err.message, /OUT-LINE/);
      assert.match(err.message, /ERR-LINE/);
      return true;
    }
  );
});

test('defaultExec preserves full multi-line output without truncation', async () => {
  // 500 lines on each stream — must all survive into the message.
  const script =
    'for (let i = 0; i < 500; i++) { process.stdout.write("out"+i+"\\n"); process.stderr.write("err"+i+"\\n"); } process.exit(1)';
  await assert.rejects(defaultExec('node', ['-e', script]), (err: unknown) => {
    assert.ok(err instanceof ExecError);
    assert.match(err.message, /out0\b/);
    assert.match(err.message, /out499\b/);
    assert.match(err.message, /err0\b/);
    assert.match(err.message, /err499\b/);
    return true;
  });
});

test('defaultExec throws ExecError with cause detail on spawn failure', async () => {
  await assert.rejects(
    defaultExec('definitely-not-a-real-binary-xyz', []),
    (err: unknown) => {
      assert.ok(err instanceof ExecError);
      assert.strictEqual(err.exitCode, null);
      // The underlying spawn error (e.g. ENOENT) is preserved.
      assert.match(err.message, /ENOENT|not found|failed to run/i);
      return true;
    }
  );
});

test('formatExecError includes both streams under labeled sections', () => {
  const msg = formatExecError({
    command: 'pnpm',
    args: ['publish', '--access', 'public'],
    exitCode: 1,
    signal: null,
    stdout: 'npm error code E401',
    stderr: 'npm error 401 Unauthorized',
  });
  assert.match(msg, /Command `pnpm publish --access public` exited with code 1/);
  assert.match(msg, /--- stdout ---\nnpm error code E401/);
  assert.match(msg, /--- stderr ---\nnpm error 401 Unauthorized/);
});

test('formatExecError reports signal termination', () => {
  const msg = formatExecError({
    command: 'cargo',
    args: ['publish'],
    exitCode: null,
    signal: 'SIGKILL',
    stdout: '',
    stderr: '',
  });
  assert.match(msg, /terminated by signal SIGKILL/);
});

test('formatExecError notes when a command produced no output', () => {
  const msg = formatExecError({
    command: 'true',
    args: [],
    exitCode: 1,
    signal: null,
    stdout: '',
    stderr: '',
  });
  assert.match(msg, /\(no output captured\)/);
});

test('binaryExists returns true for known binary', async () => {
  assert.strictEqual(await binaryExists('node'), true);
});

test('binaryExists returns false for nonexistent binary', async () => {
  assert.strictEqual(
    await binaryExists('definitely-not-a-real-binary-xyz'),
    false
  );
});
