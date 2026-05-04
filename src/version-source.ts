// ABOUTME: Version resolution with git-first priority and manifest fallback
// ABOUTME: Priority: last release commit → latest vX.Y.Z git tag → root manifest → 0.0.0

import { simpleGit } from 'simple-git';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import semver from 'semver';
import { extractVersionFromCommit, isReleaseCommit } from './release-commit.js';

/**
 * Last-resort fallback: read the version from the most-likely root manifest.
 * Used only when neither a release commit nor a semver git tag is present.
 * Bootstrapping a repo that already has, say, `0.1.0-alpha.16` in package.json
 * shouldn't quietly reset to `0.0.0`.
 */
async function readVersionFromRootManifest(repoPath: string): Promise<string | null> {
  // package.json
  try {
    const pkg = JSON.parse(await readFile(join(repoPath, 'package.json'), 'utf-8'));
    if (typeof pkg.version === 'string' && semver.valid(pkg.version)) {
      return pkg.version;
    }
  } catch {}

  // Cargo.toml — top-level [package] version, or [workspace.package] version
  try {
    const cargo = parseToml(await readFile(join(repoPath, 'Cargo.toml'), 'utf-8')) as any;
    const v = cargo?.package?.version ?? cargo?.workspace?.package?.version;
    if (typeof v === 'string' && semver.valid(v)) return v;
  } catch {}

  return null;
}

export async function resolveCurrentVersion(
  repoPath: string
): Promise<string> {
  const git = simpleGit(repoPath);

  // Strategy 1: Find last release commit (progressive search)
  let log = await git.log({ maxCount: 100 });
  for (const commit of log.all) {
    if (isReleaseCommit(commit.message)) {
      const version = extractVersionFromCommit(commit.message);
      if (version) return version;
    }
  }

  if (log.total && log.total > 100) {
    log = await git.log({ maxCount: 1000 });
    // Start from 100 since we already checked those
    for (let i = 100; i < log.all.length; i++) {
      const commit = log.all[i];
      if (isReleaseCommit(commit.message)) {
        const version = extractVersionFromCommit(commit.message);
        if (version) return version;
      }
    }
  }

  if (log.total && log.total > 1000) {
    log = await git.log();
    for (let i = 1000; i < log.all.length; i++) {
      const commit = log.all[i];
      if (isReleaseCommit(commit.message)) {
        const version = extractVersionFromCommit(commit.message);
        if (version) return version;
      }
    }
  }

  // Strategy 2: Find latest semver git tag
  try {
    const tags = await git.tags(['--sort=-v:refname']);
    for (const tag of tags.all) {
      const match = tag.match(/^v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)$/);
      if (match) return match[1];
    }
  } catch {
    // No tags, fall through
  }

  // Strategy 3: Fall back to root manifest version (package.json / Cargo.toml).
  // Lets a repo bootstrap with an existing version (e.g. an in-progress alpha)
  // without requiring an artificial release commit or git tag.
  const manifestVersion = await readVersionFromRootManifest(repoPath);
  if (manifestVersion) return manifestVersion;

  // Strategy 4: Default
  return '0.0.0';
}
