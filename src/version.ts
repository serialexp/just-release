// ABOUTME: Calculates version bumps based on conventional commit types
// ABOUTME: Determines major, minor, or patch semver increments

import semver from 'semver';
import { CommitInfo } from './commits.js';

export type BumpType = 'major' | 'minor' | 'patch' | null;

export interface VersionBumpResult {
  bumpType: BumpType;
  newVersion: string | null;
}

export function calculateVersionBump(
  currentVersion: string,
  commits: CommitInfo[]
): VersionBumpResult {
  if (commits.length === 0) {
    return { bumpType: null, newVersion: null };
  }

  let bumpType: BumpType;

  // Check for breaking changes first (major bump)
  const hasBreaking = commits.some((c) => c.breaking);
  if (hasBreaking) {
    bumpType = 'major';
  } else {
    // Check for features (minor bump)
    const hasFeat = commits.some((c) => c.type === 'feat');
    if (hasFeat) {
      bumpType = 'minor';
    } else {
      // Everything else (fix, perf, chore, docs, etc.) gets a patch bump
      bumpType = 'patch';
    }
  }

  const newVersion = semver.inc(currentVersion, bumpType);

  return {
    bumpType,
    newVersion,
  };
}
