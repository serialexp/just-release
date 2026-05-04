// ABOUTME: Calculates version bumps based on conventional commit types
// ABOUTME: Handles stable major/minor/patch and prerelease lifecycle (counter, graduate, enter)

import semver from 'semver';
import { CommitInfo } from './commits.js';

export type BumpType =
  | 'major'
  | 'minor'
  | 'patch'
  | 'prerelease' // increment prerelease counter (alpha.16 → alpha.17)
  | 'graduate' // strip prerelease (alpha.16 → 1.0.0)
  | 'enter-prerelease' // stable → prerelease (1.0.0 → 1.1.0-alpha.0)
  | null;

export interface VersionBumpResult {
  bumpType: BumpType;
  newVersion: string | null;
}

/**
 * Compute the conventional-commit-driven bump segment (major/minor/patch).
 * Used both for stable bumps and to pick the pre{major,minor,patch} variant
 * when entering a prerelease cycle from a stable version.
 */
function computeBumpFromCommits(commits: CommitInfo[]): 'major' | 'minor' | 'patch' {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
}

function stripPrerelease(version: string): string {
  const parsed = semver.parse(version);
  if (!parsed) return version;
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function calculateVersionBump(
  currentVersion: string,
  commits: CommitInfo[]
): VersionBumpResult {
  if (commits.length === 0) {
    return { bumpType: null, newVersion: null };
  }

  const isPrerelease = semver.prerelease(currentVersion) !== null;

  // Explicit `Release-As:` footer override (first non-null in the commit
  // stream wins). Two recognized forms:
  //   Release-As: stable       → graduate from prerelease
  //   Release-As: <semver>     → force exact version
  const releaseAs = commits.map((c) => c.releaseAs).find((v) => v !== null) ?? null;
  if (releaseAs) {
    if (releaseAs.toLowerCase() === 'stable') {
      const newVersion = stripPrerelease(currentVersion);
      return { bumpType: 'graduate', newVersion };
    }
    if (semver.valid(releaseAs)) {
      // Pick a bump label that reflects the diff direction; useful for
      // changelog/UX, but the version itself is whatever the footer says.
      const diff = semver.diff(currentVersion, releaseAs);
      const bumpType: BumpType =
        diff === 'major' || diff === 'minor' || diff === 'patch'
          ? diff
          : diff === 'prerelease'
            ? 'prerelease'
            : 'patch';
      return { bumpType, newVersion: releaseAs };
    }
    // Unrecognized value: fall through to normal logic but warn.
    console.warn(
      `   ⚠️  Ignoring unrecognized Release-As value: ${JSON.stringify(releaseAs)}`,
    );
  }

  // Prerelease lifecycle: in a prerelease, every release is a counter bump.
  // Conventional-commit type does NOT drive the segment — graduating to stable
  // is the only way to escape, via the Release-As footer above.
  if (isPrerelease) {
    const newVersion = semver.inc(currentVersion, 'prerelease');
    return { bumpType: 'prerelease', newVersion };
  }

  // Stable → prerelease via env var. Used once when first entering an alpha
  // cycle from a stable version. Picks pre{major,minor,patch} based on commits.
  const enterPrerelease = process.env.JUST_RELEASE_PRERELEASE?.trim();
  if (enterPrerelease) {
    const baseBump = computeBumpFromCommits(commits);
    const preBumpType = `pre${baseBump}` as semver.ReleaseType;
    const newVersion = semver.inc(currentVersion, preBumpType, enterPrerelease);
    return { bumpType: 'enter-prerelease', newVersion };
  }

  // Stable bump (existing behavior).
  const bumpType = computeBumpFromCommits(commits);
  return { bumpType, newVersion: semver.inc(currentVersion, bumpType) };
}
