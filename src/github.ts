// ABOUTME: Manages GitHub API interactions for PR creation and updates
// ABOUTME: Handles release branch detection and repository information extraction

import { Octokit } from '@octokit/rest';
import { simpleGit, SimpleGit } from 'simple-git';

export interface RepoInfo {
  owner: string;
  repo: string;
}

export async function getRepoInfo(repoPath: string): Promise<RepoInfo> {
  const git: SimpleGit = simpleGit(repoPath);
  const remotes = await git.getRemotes(true);

  const origin = remotes.find((r) => r.name === 'origin');
  if (!origin) {
    throw new Error('No origin remote found');
  }

  const url = origin.refs.fetch || origin.refs.push || '';

  // Parse GitHub URL (supports both HTTPS and SSH)
  let match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/);

  if (!match) {
    throw new Error(`Could not parse GitHub repo from remote URL: ${url}`);
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

export function findExistingReleaseBranch(
  branches: Array<{ name: string }>
): string | null {
  const releaseDatePattern = /^release\/\d{4}-\d{2}-\d{2}$/;
  const releaseBranch = branches.find((b) => releaseDatePattern.test(b.name));
  return releaseBranch ? releaseBranch.name : null;
}

export async function createOrUpdatePR(
  repoPath: string,
  branchName: string,
  version: string,
  changelogSummary: string,
  token: string
): Promise<{ url: string; isNew: boolean }> {
  const octokit = new Octokit({ auth: token });
  const repoInfo = await getRepoInfo(repoPath);

  // Get default branch (usually main or master)
  const { data: repo } = await octokit.repos.get({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
  });
  const baseBranch = repo.default_branch;

  const title = `release: ${version}`;
  const body = `## Release ${version}\n\n${changelogSummary}`;

  // Check if a PR already exists for this branch
  const { data: prsForBranch } = await octokit.pulls.list({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    head: `${repoInfo.owner}:${branchName}`,
    base: baseBranch,
    state: 'open',
  });

  if (prsForBranch.length > 0) {
    // Update existing PR for this branch
    const pr = prsForBranch[0];
    await octokit.pulls.update({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: pr.number,
      title,
      body,
    });

    return { url: pr.html_url, isNew: false };
  }

  // Check for any other open release PRs and close them
  const { data: allPrs } = await octokit.pulls.list({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    base: baseBranch,
    state: 'open',
  });

  const otherReleasePrs = allPrs.filter((pr) =>
    (pr.title.startsWith('Release ') || pr.title.startsWith('release: ')) && pr.head.ref.startsWith('release/')
  );

  for (const oldPr of otherReleasePrs) {
    await octokit.pulls.update({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: oldPr.number,
      state: 'closed',
    });
  }

  // Create new PR
  const { data: pr } = await octokit.pulls.create({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    head: branchName,
    base: baseBranch,
    title,
    body,
  });

  return { url: pr.html_url, isNew: true };
}

export async function createOrUpdateGitHubRelease(
  repoPath: string,
  version: string,
  releaseNotes: string,
  token: string
): Promise<{ url: string; isNew: boolean; releaseId: number }> {
  // Octokit's default `log.warn` prints a line like
  //   `GET /repos/.../releases/tags/v0.13.2 - 404 with id ... in 321ms`
  // for any 4xx response. The 404 from the existence probe below is
  // expected on every first-time release and looks like an error in CI
  // logs. Silence Octokit's per-request warnings — we surface our own
  // status messages, and any *real* problem still throws and is handled
  // by the caller.
  const octokit = new Octokit({
    auth: token,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: console.error,
    },
  });
  const repoInfo = await getRepoInfo(repoPath);
  const git: SimpleGit = simpleGit(repoPath);

  const tagName = `v${version}`;

  // Get the current HEAD commit SHA
  const currentCommit = await git.revparse(['HEAD']);

  // Check if release already exists
  let existingRelease;
  try {
    const { data } = await octokit.repos.getReleaseByTag({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      tag: tagName,
    });
    existingRelease = data;
    console.log(`   Release ${tagName} already exists, updating tag and notes...`);
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      console.log(`   Release ${tagName} doesn't exist yet, creating...`);
    } else {
      throw error;
    }
  }

  if (existingRelease) {
    // Get the old commit SHA from the existing tag
    const { data: tagRef } = await octokit.git.getRef({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      ref: `tags/${tagName}`,
    });
    const oldCommit = tagRef.object.sha;
    const newCommit = currentCommit.trim();

    // Update the tag to point to the current commit
    await octokit.git.updateRef({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      ref: `tags/${tagName}`,
      sha: newCommit,
      force: true,
    });

    // Append SHA update note to the release notes
    const timestamp = new Date().toISOString();
    const updatedNotes =
      `${releaseNotes}\n\n---\n` +
      `*Tag updated from \`${oldCommit.slice(0, 7)}\` to \`${newCommit.slice(0, 7)}\` at ${timestamp}*`;

    // Update the release notes
    await octokit.repos.updateRelease({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      release_id: existingRelease.id,
      name: `Release ${version}`,
      body: updatedNotes,
    });

    return { url: existingRelease.html_url, isNew: false, releaseId: existingRelease.id };
  }

  // Create new release
  const { data: release } = await octokit.repos.createRelease({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    tag_name: tagName,
    name: `Release ${version}`,
    body: releaseNotes,
    draft: false,
    prerelease: false,
  });

  return { url: release.html_url, isNew: true, releaseId: release.id };
}

/**
 * Upload files to a release as assets. Any existing asset with the same name is
 * deleted first, so re-runs (e.g. a tag update on a re-released version) are
 * idempotent rather than failing on a name clash.
 */
export async function uploadReleaseAssets(
  token: string,
  repoInfo: RepoInfo,
  releaseId: number,
  files: Array<{ name: string; data: Buffer }>
): Promise<void> {
  if (files.length === 0) return;

  const octokit = new Octokit({
    auth: token,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: console.error },
  });

  const existing = await octokit.paginate(octokit.repos.listReleaseAssets, {
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    release_id: releaseId,
    per_page: 100,
  });

  for (const file of files) {
    const clash = existing.find((a) => a.name === file.name);
    if (clash) {
      await octokit.repos.deleteReleaseAsset({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        asset_id: clash.id,
      });
    }

    await octokit.repos.uploadReleaseAsset({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      release_id: releaseId,
      name: file.name,
      // Octokit types `data` as string, but binary uploads accept a Buffer.
      data: file.data as unknown as string,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': file.data.length,
      },
    });
  }
}

