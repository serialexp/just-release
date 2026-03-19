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
): Promise<{ url: string; isNew: boolean }> {
  const octokit = new Octokit({ auth: token });
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
  } catch (error) {
    // Release doesn't exist, we'll create a new one
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

    return { url: existingRelease.html_url, isNew: false };
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

  return { url: release.html_url, isNew: true };
}

