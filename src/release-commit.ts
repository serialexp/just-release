// ABOUTME: Utilities for detecting release commits and extracting version numbers
// ABOUTME: Supports multiple commit message formats (release:, chore: release, etc.)

/**
 * Checks if a commit message indicates a release.
 *
 * Supported formats — all anchored to the start of the subject line so that
 * commits which merely *mention* a release (e.g. dependency bumps like
 * `chore(deps): bump just-release 0.13.2 → 0.13.4`) are not misidentified:
 * - "release: 1.2.3"
 * - "release v1.2.3" / "release 1.2.3"
 * - "chore: release v1.2.3"
 * - "chore(scope): release 2.0.0-beta.1"
 * - "chore(release): v1.2.3"
 */
export function isReleaseCommit(message: string): boolean {
  // Match against the subject (first line) only — body content is irrelevant
  // and would otherwise re-introduce the substring-match false-positive class.
  const subject = message.split('\n', 1)[0];

  const patterns: RegExp[] = [
    // "release: 1.2.3" / "release v1.2.3" / "release 1.2.3"
    /^release[\s:]+v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/i,
    // "chore: release v1.2.3" / "chore(scope): release 2.0.0-beta.1"
    /^chore(?:\([^)]+\))?:\s+release\b[\s:]*v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/i,
    // "chore(release): v1.2.3"
    /^chore\(release\):\s+v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/i,
  ];

  return patterns.some((p) => p.test(subject));
}

/**
 * Extracts the version number from a release commit message
 * Returns null if the message is not a release commit
 */
export function extractVersionFromCommit(message: string): string | null {
  if (!isReleaseCommit(message)) {
    return null;
  }

  // Extract semver version (with optional "v" prefix and prerelease suffix)
  const versionPattern = /v?(\d+\.\d+\.\d+(?:\-[a-zA-Z0-9.]+)?)/;
  const match = message.match(versionPattern);

  return match ? match[1] : null;
}
