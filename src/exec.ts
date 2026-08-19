// ABOUTME: Shell execution utilities for running publish commands
// ABOUTME: Provides injectable exec function and binary detection for testing

import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecFn, ExecResult } from './ecosystems/types.js';

const execFileAsync = promisify(nodeExecFile);

// Large enough that we never truncate a command's output just to report it.
// The whole point of ExecError is to surface everything the command printed.
const MAX_OUTPUT_BUFFER = 64 * 1024 * 1024;

/**
 * Error thrown when a spawned command fails. Unlike Node's default execFile
 * rejection — whose `.message` is only `Command failed: <cmd>` — this captures
 * the exit code and the command's *complete* stdout and stderr, and folds all
 * of it into `.message`. Callers that surface `err.message` (the ecosystem
 * publish adapters) therefore report the real reason a command failed instead
 * of a generic line.
 */
export class ExecError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(params: {
    command: string;
    args: string[];
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    /** Underlying failure detail when there is no exit code (e.g. spawn ENOENT). */
    cause?: string;
  }) {
    super(formatExecError(params));
    this.name = 'ExecError';
    this.command = params.command;
    this.args = params.args;
    this.exitCode = params.exitCode;
    this.signal = params.signal;
    this.stdout = params.stdout;
    this.stderr = params.stderr;
  }

  /** Build an ExecError from an unknown value thrown by execFile. */
  static from(err: unknown, command: string, args: string[]): ExecError {
    const e = (err ?? {}) as {
      code?: unknown;
      signal?: unknown;
      stdout?: unknown;
      stderr?: unknown;
      message?: unknown;
    };
    const exitCode = typeof e.code === 'number' ? e.code : null;
    const stdout = normalizeStream(e.stdout);
    const stderr = normalizeStream(e.stderr);
    // When there's no numeric exit code the process never ran (spawn failure,
    // e.g. ENOENT). Keep the original message so "spawn cargo ENOENT" survives.
    const cause =
      exitCode === null
        ? typeof e.message === 'string'
          ? e.message
          : String(err)
        : undefined;
    return new ExecError({
      command,
      args,
      exitCode,
      signal: typeof e.signal === 'string' ? e.signal : null,
      stdout,
      stderr,
      cause,
    });
  }
}

function normalizeStream(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  return String(value);
}

function describeExitStatus(
  exitCode: number | null,
  signal: string | null
): string {
  if (signal) return `terminated by signal ${signal}`;
  if (exitCode !== null) return `exited with code ${exitCode}`;
  return 'failed to run';
}

/**
 * Format an exec failure into a complete, multi-line message: a status line
 * followed by the command's entire stdout and stderr. Nothing is trimmed or
 * elided — if a caller wants less, it can filter downstream.
 */
export function formatExecError(params: {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  cause?: string;
}): string {
  const cmdline = [params.command, ...params.args].join(' ');
  const parts = [
    `Command \`${cmdline}\` ${describeExitStatus(params.exitCode, params.signal)}`,
  ];

  const stdout = params.stdout.trimEnd();
  const stderr = params.stderr.trimEnd();

  // Spawn failures carry no output; keep their underlying detail.
  if (params.cause && !stdout && !stderr) {
    parts.push(params.cause);
  }
  if (stdout) parts.push(`--- stdout ---\n${stdout}`);
  if (stderr) parts.push(`--- stderr ---\n${stderr}`);
  if (!params.cause && !stdout && !stderr) {
    parts.push('(no output captured)');
  }

  return parts.join('\n');
}

export const defaultExec: ExecFn = async (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): Promise<ExecResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      maxBuffer: MAX_OUTPUT_BUFFER,
    });
    return { stdout, stderr };
  } catch (err) {
    throw ExecError.from(err, command, args);
  }
};

export async function binaryExists(name: string): Promise<boolean> {
  try {
    await execFileAsync(name, ['--version']);
    return true;
  } catch {
    return false;
  }
}
