// ABOUTME: Tests for release commit detection and version extraction
// ABOUTME: Validates various commit message formats that indicate a release

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isReleaseCommit, extractVersionFromCommit } from './release-commit.js';

describe('isReleaseCommit', () => {
  it('should recognize "release: 1.2.3" format', () => {
    assert.strictEqual(isReleaseCommit('release: 1.2.3'), true);
  });

  it('should recognize "chore: release v1.2.3" format', () => {
    assert.strictEqual(isReleaseCommit('chore: release v1.2.3'), true);
  });

  it('should recognize "release v1.2.3" format', () => {
    assert.strictEqual(isReleaseCommit('release v1.2.3'), true);
  });

  it('should recognize "chore(release): v1.2.3" format', () => {
    assert.strictEqual(isReleaseCommit('chore(release): v1.2.3'), true);
  });

  it('should recognize "chore(deps): release 2.0.0-beta.1" format', () => {
    assert.strictEqual(isReleaseCommit('chore(deps): release 2.0.0-beta.1'), true);
  });

  it('should not recognize non-release commits', () => {
    assert.strictEqual(isReleaseCommit('feat: add new feature'), false);
    assert.strictEqual(isReleaseCommit('fix: fix bug'), false);
    assert.strictEqual(isReleaseCommit('chore: update dependencies'), false);
  });

  it('should not recognize commits that mention release but are not releases', () => {
    // Documentation about releases
    assert.strictEqual(isReleaseCommit('docs: release notes for v1.2.3'), false);
    assert.strictEqual(isReleaseCommit('docs: update release documentation'), false);

    // Tooling updates
    assert.strictEqual(isReleaseCommit('chore: update release script to support 1.2.3'), false);
    assert.strictEqual(isReleaseCommit('chore: prepare release'), false);

    // Feature releases (not version releases)
    assert.strictEqual(isReleaseCommit('feat: release the kraken'), false);
    assert.strictEqual(isReleaseCommit('feat: released new authentication flow'), false);

    // Past tense mentions
    assert.strictEqual(isReleaseCommit('fix: bug in released feature'), false);
    assert.strictEqual(isReleaseCommit('fix: released feature had a bug'), false);
  });

  it('should not match dependency bumps that mention a tool whose name contains "release"', () => {
    // Regression: the previous substring-based regex matched on
    // "release 0.13.2" inside the package name "just-release", causing the
    // post-release-mode detector to fire on a routine dep bump and try to
    // republish the prior version.
    assert.strictEqual(
      isReleaseCommit('chore(deps): bump just-release 0.13.2 → 0.13.4'),
      false
    );
    assert.strictEqual(
      isReleaseCommit('chore(deps): bump just-release from 0.13.2 to 0.13.4'),
      false
    );
    assert.strictEqual(
      isReleaseCommit('chore: update @aeolun/just-release to 0.13.4'),
      false
    );
    assert.strictEqual(
      isReleaseCommit('fix(release-notes): correct typo in 1.2.3 entry'),
      false
    );
  });

  it('should handle multi-line commit messages', () => {
    const message = 'chore: release v1.2.3\n\nThis is a release commit';
    assert.strictEqual(isReleaseCommit(message), true);
  });
});

describe('extractVersionFromCommit', () => {
  it('should extract version from "release: 1.2.3"', () => {
    assert.strictEqual(extractVersionFromCommit('release: 1.2.3'), '1.2.3');
  });

  it('should extract version from "chore: release v1.2.3"', () => {
    assert.strictEqual(extractVersionFromCommit('chore: release v1.2.3'), '1.2.3');
  });

  it('should extract version with "v" prefix', () => {
    assert.strictEqual(extractVersionFromCommit('release v2.0.0'), '2.0.0');
  });

  it('should extract prerelease versions', () => {
    assert.strictEqual(extractVersionFromCommit('release: 1.0.0-beta.1'), '1.0.0-beta.1');
  });

  it('should extract version from multi-line message', () => {
    const message = 'chore: release v1.2.3\n\nThis is a release commit';
    assert.strictEqual(extractVersionFromCommit(message), '1.2.3');
  });

  it('should return null for non-release commits', () => {
    assert.strictEqual(extractVersionFromCommit('feat: add new feature'), null);
  });
});
