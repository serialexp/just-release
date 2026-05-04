// ABOUTME: Analyzes git commits and parses conventional commit messages
// ABOUTME: Maps file changes to workspace packages for changelog generation

import { simpleGit, SimpleGit, DefaultLogFields } from 'simple-git';
import * as conventionalCommitsParser from 'conventional-commits-parser';
import { WorkspacePackage } from './workspace.js';
import { isReleaseCommit } from './release-commit.js';

const { CommitParser } = conventionalCommitsParser as any;
const parser = new CommitParser();

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

  // Only analyze commits since last release (or all if no release found)
  const endIndex = releaseIndex === -1 ? log.all.length : releaseIndex;
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
    const releaseAsNote = parsed.notes.find(
      (note: any) => typeof note.title === 'string' && note.title.toLowerCase() === 'release-as',
    );
    const releaseAs =
      releaseAsNote && typeof releaseAsNote.text === 'string'
        ? releaseAsNote.text.trim() || null
        : null;

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
