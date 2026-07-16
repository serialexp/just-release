// ABOUTME: Analyzes git commits and parses conventional commit messages
// ABOUTME: Maps file changes to workspace packages for changelog generation

import { simpleGit, SimpleGit, DefaultLogFields } from 'simple-git';
import semver from 'semver';
import * as conventionalCommitsParser from 'conventional-commits-parser';
import { WorkspacePackage } from './workspace.js';
import { isReleaseCommit } from './release-commit.js';

const { CommitParser } = conventionalCommitsParser as any;
// Collect `Release-As:` trailers into `parsed.notes` alongside the defaults.
// Without this, CommitParser only surfaces BREAKING CHANGE notes, so the
// `Release-As: <version>` / `Release-As: stable` footers are silently dropped
// and version pinning / prerelease graduation never fire. noteKeyword matching
// is case-insensitive by default, so `release-as` / `RELEASE-AS` also work.
const parser = new CommitParser({
  noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE', 'Release-As'],
});

/**
 * Resolve the commit hash of the most recent semver git tag (`vX.Y.Z` or
 * `X.Y.Z`, optionally with a prerelease suffix). Used to anchor the analysis
 * window when a repo has no `release:` commit yet — e.g. one migrating from
 * manual tagging — so the first automated run only considers commits since that
 * tag instead of the entire history. Returns null when no semver tag exists.
 */
async function findLatestSemverTagCommit(git: SimpleGit): Promise<string | null> {
  try {
    const tags = await git.tags(['--sort=-v:refname']);
    for (const tag of tags.all) {
      if (/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(tag)) {
        const hash = (await git.raw(['rev-list', '-n', '1', tag])).trim();
        if (hash) return hash;
      }
    }
  } catch {
    // No tags (or not resolvable) — fall through to null.
  }
  return null;
}

export interface CommitInfo {
  hash: string;
  type: string | null;
  scope: string | null;
  subject: string | null;
  body: string | null;
  breaking: boolean;
  packages: string[];
  files: string[];
  rawMessage: string; // First line of original commit message (for fallback display)
  /**
   * Value of a `Release-As:` footer (case-insensitive) when present, e.g.
   * `Release-As: stable` (graduate from prerelease) or `Release-As: 1.0.0`
   * (force exact version). null when the footer is absent.
   */
  releaseAs: string | null;
}

export async function analyzeCommits(
  repoPath: string,
  workspacePackages: WorkspacePackage[]
): Promise<CommitInfo[]> {
  const git: SimpleGit = simpleGit(repoPath);

  // Check if this is a shallow repository
  const isShallow = await git.raw(['rev-parse', '--is-shallow-repository']);
  if (isShallow.trim() === 'true') {
    let errorMessage = 'Shallow repository detected. just-release requires full git history.\n';

    if (process.env.GITHUB_ACTIONS) {
      errorMessage += '\nAdd fetch-depth: 0 to your checkout action:\n\n';
      errorMessage += '  - uses: actions/checkout@v4\n';
      errorMessage += '    with:\n';
      errorMessage += '      fetch-depth: 0\n';
    } else {
      errorMessage += 'Run: git fetch --unshallow';
    }

    throw new Error(errorMessage);
  }

  // Fetch commits in stages to optimize performance
  let log = await git.log({ maxCount: 100 });
  let releaseIndex = log.all.findIndex(c => isReleaseCommit(c.message));

  // If no release found in first 100, try 1000
  if (releaseIndex === -1 && log.total && log.total > 100) {
    log = await git.log({ maxCount: 1000 });
    releaseIndex = log.all.findIndex(c => isReleaseCommit(c.message));
  }

  // If still no release found, warn and fetch all
  if (releaseIndex === -1 && log.total && log.total > 1000) {
    console.warn('   ⚠️  No release commit found in last 1000 commits. Searching full history (this may take a while)...');
    log = await git.log();
    releaseIndex = log.all.findIndex(c => isReleaseCommit(c.message));
  }

  // Determine where the analysis window ends (exclusive). Anchor priority:
  //   1. last `release:` commit — just-release's own release boundary
  //   2. latest semver git tag — repos migrating from manual tagging, so the
  //      first automated run only considers commits since that tag
  //   3. all history — a brand-new repo with neither
  let endIndex: number;
  if (releaseIndex !== -1) {
    endIndex = releaseIndex;
  } else {
    const tagCommit = await findLatestSemverTagCommit(git);
    let tagIndex = tagCommit ? log.all.findIndex((c) => c.hash === tagCommit) : -1;
    // The tag may predate the currently-fetched window; widen to full history
    // to locate it (bootstrap-only, so the extra fetch is acceptable).
    if (tagCommit && tagIndex === -1) {
      log = await git.log();
      tagIndex = log.all.findIndex((c) => c.hash === tagCommit);
    }
    endIndex = tagIndex === -1 ? log.all.length : tagIndex;
  }
  const commitsToAnalyze = log.all.slice(0, endIndex);

  const commits: CommitInfo[] = [];

  for (const commit of commitsToAnalyze) {
    // Parse conventional commit (combine message and body for full parsing)
    const fullMessage = commit.body
      ? `${commit.message}\n\n${commit.body}`
      : commit.message;
    const parsed = parser.parse(fullMessage);

    // Get files changed in this commit
    const diffSummary = await git.show([
      '--name-only',
      '--format=',
      commit.hash,
    ]);
    const files = diffSummary
      .split('\n')
      .filter((line) => line.trim().length > 0);

    // Map files to packages
    const affectedPackages = new Set<string>();

    for (const file of files) {
      for (const pkg of workspacePackages) {
        const relativePkgPath = pkg.path.replace(repoPath + '/', '');
        // For single-package repos, pkg.path === repoPath, so relativePkgPath will be unchanged
        // In that case, all files belong to the root package
        if (relativePkgPath === pkg.path) {
          // Root package - all files belong to it
          affectedPackages.add(pkg.name);
        } else if (file.startsWith(relativePkgPath)) {
          affectedPackages.add(pkg.name);
        }
      }
    }

    // Check for breaking changes
    const breaking =
      parsed.notes.some((note: any) => note.title === 'BREAKING CHANGE') ||
      commit.message.includes('!:');

    // Look for a `Release-As:` footer. Conventional-commits-parser collects
    // any "Title: text" trailer-style footer into `notes`. We match
    // case-insensitively so contributors can write `release-as`, `Release-As`,
    // or `RELEASE-AS` and still hit the same code path.
    //
    // A body sentence that merely *begins* with the keyword (e.g. "Release-As
    // pins the first release, since…") is also collected as a note. To keep such
    // prose from shadowing a real `Release-As: <version>` footer, prefer the
    // first note whose value is a recognized pin (valid semver or "stable"),
    // and only fall back to the first note otherwise so a lone malformed value
    // still surfaces the downstream warning.
    const releaseAsValues = parsed.notes
      .filter(
        (note: any) =>
          typeof note.title === 'string' && note.title.toLowerCase() === 'release-as',
      )
      .map((note: any) => (typeof note.text === 'string' ? note.text.trim() : ''))
      .filter((text: string) => text.length > 0);
    const releaseAs =
      releaseAsValues.find(
        (v: string) => v.toLowerCase() === 'stable' || semver.valid(v) !== null,
      ) ??
      releaseAsValues[0] ??
      null;

    commits.push({
      hash: commit.hash,
      type: parsed.type ?? null,
      scope: parsed.scope ?? null,
      subject: parsed.subject ?? null,
      body: parsed.body ?? null,
      breaking,
      packages: Array.from(affectedPackages),
      files,
      rawMessage: commit.message, // First line of the original commit message
      releaseAs,
    });
  }

  // Return commits in chronological order (oldest first)
  return commits.reverse();
}
