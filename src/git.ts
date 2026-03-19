// ABOUTME: Handles git operations for creating release branches and commits
// ABOUTME: Delegates version updates to ecosystem-specific adapters

import { simpleGit, SimpleGit } from 'simple-git';
import type { WorkspaceInfo } from './workspace.js';
import { updateAllVersions } from './ecosystems/index.js';

async function ensureGitConfig(git: SimpleGit): Promise<void> {
  // Only configure if we're in GitHub Actions
  if (!process.env.GITHUB_ACTIONS) {
    return;
  }

  // Check if user.name is already configured locally (not global)
  try {
    const userName = await git.getConfig('user.name', 'local');
    const userEmail = await git.getConfig('user.email', 'local');

    // If both are configured locally, we're good
    if (userName.value && userEmail.value) {
      return;
    }
  } catch (error) {
    // Config not set, continue to set defaults
  }

  // Set github-actions[bot] as default (local config)
  await git.addConfig('user.name', 'github-actions[bot]', false, 'local');
  await git.addConfig('user.email', 'github-actions[bot]@users.noreply.github.com', false, 'local');
}

export async function createReleaseBranch(repoPath: string): Promise<{ name: string; isNew: boolean }> {
  const git: SimpleGit = simpleGit(repoPath);

  // Check both local and remote branches for existing release branches
  const branches = await git.branch(['-a']); // -a includes remote branches
  const allBranches = branches.all;

  // Look for release branches matching our format (release/YYYY-MM-DD)
  const releaseDatePattern = /^release\/\d{4}-\d{2}-\d{2}$/;
  const existingReleaseBranch = allBranches.find((b) => {
    const name = b.replace('remotes/origin/', '');
    return releaseDatePattern.test(name);
  });

  let branchName: string;
  let isNew: boolean;

  if (existingReleaseBranch) {
    // Extract branch name (remove remotes/origin/ prefix if present)
    branchName = existingReleaseBranch.replace('remotes/origin/', '');
    isNew = false;

    // Get current commit SHA (we should be on main)
    const currentCommit = await git.revparse(['HEAD']);

    // Checkout the branch (creating local tracking branch if needed)
    try {
      await git.checkout(branchName);
    } catch {
      // Branch doesn't exist locally, create it tracking the remote
      await git.checkoutBranch(branchName, `origin/${branchName}`);
    }

    // Reset to main's current state
    await git.reset(['--hard', currentCommit.trim()]);
  } else {
    // Create new branch with current date
    const today = new Date().toISOString().split('T')[0];
    branchName = `release/${today}`;
    isNew = true;
    await git.checkoutLocalBranch(branchName);
  }

  return { name: branchName, isNew };
}

export async function updatePackageVersions(
  workspace: WorkspaceInfo,
  newVersion: string
): Promise<void> {
  await updateAllVersions(
    workspace.rootPath,
    newVersion,
    workspace.packages,
    workspace.adapters
  );
}

export async function commitAndPush(
  repoPath: string,
  newVersion: string,
  push: boolean
): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);

  // Ensure git is configured (auto-configure in GitHub Actions if needed)
  await ensureGitConfig(git);

  // Stage all changes
  await git.add('.');

  // Commit with release message
  await git.commit(`release: ${newVersion}`);

  if (push) {
    // Push to remote (force push to update existing branch)
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    await git.push('origin', currentBranch.trim(), ['--force', '--set-upstream']);
  }
}
