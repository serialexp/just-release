#!/usr/bin/env node
// ABOUTME: CLI entry point for just-release tool
// ABOUTME: Orchestrates release workflow with dry-run and live modes

import { detectWorkspace } from './workspace.js';
import { analyzeCommits, CommitInfo } from './commits.js';
import { calculateVersionBump } from './version.js';
import { generateChangelogs } from './changelog.js';
import {
  createReleaseBranch,
  updatePackageVersions,
  commitAndPush,
} from './git.js';
import {
  createOrUpdatePR,
  createOrUpdateGitHubRelease,
  uploadReleaseAssets,
  getRepoInfo,
} from './github.js';
import { collectRunArtifactFiles } from './artifacts.js';
import { getColors } from './colors.js';
import { generateChangelogSection, groupCommitsByPackage } from './changelog.js';
import { simpleGit } from 'simple-git';
import { getCommitPrefix, generatePRSummary } from './formatting.js';
import { detectPostRelease } from './post-release.js';
import {
  publishAllPackages,
  hasPublishFailures,
  allPublishesFailed,
} from './publish.js';
import { detectWorkflowPublishSteps } from './workflow-publish-check.js';
import { createRequire } from 'node:module';
import type { WorkspacePackage } from './workspace.js';

const require = createRequire(import.meta.url);
const { version: toolVersion } = require('../package.json');
const colors = getColors(process.env, process.stdout.isTTY);

function getManifestName(pkg: WorkspacePackage): string {
  switch (pkg.ecosystem) {
    case 'javascript': return 'package.json';
    case 'rust': return 'Cargo.toml';
    case 'go': return 'go.mod';
  }
}

async function runPostRelease(cwd: string) {
  console.log('📦 Post-release mode detected\n');

  // Check for GITHUB_TOKEN
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.error('❌ GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  // Get current version from git history
  const workspace = await detectWorkspace(cwd);
  const version = workspace.rootVersion;

  // Check if the workflow already has its own publish steps
  const workflowCheck = await detectWorkflowPublishSteps(cwd);
  let publishFailed = false;
  let allFailed = false;

  if (workflowCheck.hasExternalPublish) {
    console.log('⚠️  ════════════════════════════════════════════════════════════');
    console.log('⚠️  Workflow already contains publish steps — skipping publishing');
    console.log('⚠️');
    console.log(`⚠️  Detected: ${workflowCheck.matches.join(', ')}`);
    console.log('⚠️');
    console.log('⚠️  just-release handles publishing automatically. Remove the');
    console.log('⚠️  publish steps from your workflow to avoid double-publishing.');
    console.log('⚠️  ════════════════════════════════════════════════════════════\n');
  } else {
    // Publish packages to registries (before GitHub release so packages are
    // available when the release is announced / Go tag is created)
    console.log('📦 Publishing packages...\n');
    const summaries = await publishAllPackages(
      cwd,
      version,
      workspace.packages,
      workspace.adapters
    );

    for (const summary of summaries) {
      if (summary.skipped) {
        console.log(
          `   Skipping ${summary.ecosystem} publishing: ${summary.skipReason}`
        );
      } else {
        for (const result of summary.results) {
          if (result.success) {
            const versioned = result.version
              ? `${result.packageName}@${result.version}`
              : result.packageName;
            const destination = result.registry
              ? ` → ${result.registry}`
              : '';
            console.log(`   ✅ Published ${versioned}${destination}`);
          } else {
            console.log(
              `   ❌ Failed to publish ${result.packageName}: ${result.error}`
            );
          }
          if (result.warnings) {
            for (const warning of result.warnings) {
              console.log(`   ⚠️  ${warning}`);
            }
          }
        }
      }
    }

    if (hasPublishFailures(summaries)) {
      publishFailed = true;
      allFailed = allPublishesFailed(summaries);
      console.log('\n⚠️  Some packages failed to publish\n');
    } else if (summaries.length > 0) {
      console.log();
    }
  }

  // If publishing was attempted and nothing made it to a registry, there's
  // nothing to announce — skip the GitHub release rather than advertising a
  // version that was never published.
  if (allFailed) {
    console.error(
      '❌ No packages were published — skipping GitHub release creation.\n'
    );
    process.exit(1);
  }

  console.log(`📝 Creating GitHub release for v${version}...\n`);

  // Read changelog to get release notes
  const changelogPath = `${cwd}/CHANGELOG.md`;
  const { readFile } = await import('node:fs/promises');
  let releaseNotes = '';

  try {
    const changelog = await readFile(changelogPath, 'utf-8');
    // Extract the first version section (everything between first ## and second ##)
    const match = changelog.match(/## [^\n]+\n([\s\S]*?)(?=\n## |$)/);
    if (match) {
      releaseNotes = match[1].trim();
    }
  } catch (error) {
    console.log('   No CHANGELOG.md found, creating release without notes');
  }

  // Create or update GitHub release
  const { url: releaseUrl, isNew, releaseId } = await createOrUpdateGitHubRelease(
    cwd,
    version,
    releaseNotes,
    githubToken
  );

  console.log(`   Release URL: ${releaseUrl}\n`);
  if (isNew) {
    console.log('✅ GitHub release created!\n');
  } else {
    console.log('✅ GitHub release updated!\n');
  }

  // Attach this workflow run's uploaded artifacts as release assets. Only runs
  // inside GitHub Actions (needs the run id and `actions: read`); local
  // post-release runs skip this silently.
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_RUN_ID) {
    const runId = Number(process.env.GITHUB_RUN_ID);
    console.log('📎 Attaching workflow artifacts to release...');
    try {
      const repoInfo = await getRepoInfo(cwd);
      const files = await collectRunArtifactFiles(githubToken, repoInfo, runId);
      if (files.length === 0) {
        console.log('   No workflow artifacts found for this run.\n');
      } else {
        await uploadReleaseAssets(githubToken, repoInfo, releaseId, files);
        for (const f of files) {
          console.log(`   • ${f.name} (${f.data.length} bytes)`);
        }
        console.log(`✅ Attached ${files.length} asset(s)\n`);
      }
    } catch (error) {
      // A failed asset upload shouldn't undo a successful release.
      console.error(`⚠️  Failed to attach artifacts: ${(error as Error).message}\n`);
    }
  }

  if (publishFailed) {
    process.exit(1);
  }
}

async function main() {
  const isDryRun = process.env.CI !== '1';
  const showPrPreview = process.argv.includes('--pr');
  const cwd = process.cwd();

  console.log(`🚀 just-release (version: ${toolVersion})\n`);

  if (await detectPostRelease(cwd)) {
    await runPostRelease(cwd);
    return;
  }

  if (isDryRun) {
    console.log('🔍 Running in DRY-RUN mode (set CI=1 to execute)\n');
  } else {
    console.log('✅ Running in LIVE mode\n');
  }

  try {
    // Step 1: Detect workspace
    console.log('📦 Detecting workspace...');
    const workspace = await detectWorkspace(cwd);

    // Check if this is a single-package repo (root package only)
    const isSinglePackage =
      workspace.packages.length === 1 &&
      workspace.packages[0].path === workspace.rootPath;

    if (isSinglePackage) {
      const pkg = workspace.packages[0];
      console.log(`   Single-package repo (${pkg.ecosystem})`);
    } else {
      console.log(
        `   Found ${workspace.packages.length} package(s) in workspace`
      );
      for (const eco of workspace.detectedEcosystems) {
        const count = workspace.packages.filter((p) => p.ecosystem === eco).length;
        console.log(`     - ${eco}: ${count} package(s)`);
      }
    }
    console.log(`   Current version: ${workspace.rootVersion}\n`);

    // Step 2: Analyze commits
    console.log('📝 Analyzing commits since last release...');
    const commits = await analyzeCommits(cwd, workspace.packages);

    if (commits.length === 0) {
      console.log(`   Found ${commits.length} commit(s) since last release`);
      console.log('\n✨ No new commits since last release. Nothing to do!');
      process.exit(0);
    }

    console.log(`   Found ${commits.length} commit(s) since last release:`);

    // Summarize commit types
    const commitCounts = new Map<string, number>();
    for (const commit of commits) {
      const type = commit.type || 'other';
      commitCounts.set(type, (commitCounts.get(type) || 0) + 1);
    }

    const sortedCounts = Array.from(commitCounts.entries())
      .sort((a, b) => b[1] - a[1]); // Sort by count descending

    for (const [type, count] of sortedCounts) {
      console.log(`     - ${count} ${type}`);
    }
    console.log();

    // Step 3: Calculate version bump
    console.log('🔢 Calculating version bump...');
    const versionBump = calculateVersionBump(
      workspace.rootVersion,
      commits
    );

    console.log(
      `   Bump type: ${versionBump.bumpType} (${workspace.rootVersion} → ${versionBump.newVersion})\n`
    );

    if (isDryRun) {
      // Count manifest files that would be updated (Go has no version in manifest)
      const manifestCount = workspace.packages
        .filter((p) => p.ecosystem !== 'go')
        .length + (workspace.detectedEcosystems.includes('javascript') ? 1 : 0); // +1 for root package.json
      const today = new Date().toISOString().split('T')[0];
      const branchName = `release/${today}`;

      console.log('🎯 Dry-run summary:');
      console.log(`   • Would create release branch ${colors.blue}${branchName}${colors.reset}`);
      console.log(
        `   • Would update ${manifestCount} manifest file(s)`
      );
      console.log(`   • Would generate changelogs for affected packages`);
      console.log(`   • Would commit changes with message: "release: ${versionBump.newVersion}"`);
      console.log(`   • Would push to remote and create/update PR`);
      console.log(
        '\n💡 Set CI=1 to execute these changes for real.\n'
      );

      if (showPrPreview) {
        console.log('📄 PR Preview:\n');

        // Generate PR title and body
        const prTitle = `Release ${versionBump.newVersion}`;
        console.log(`${colors.blue}Title:${colors.reset}`);
        console.log(`   ${prTitle}\n`);

        // Generate changelog summary for PR body
        const changelogSummary = generatePRSummary(commits);

        console.log(`${colors.blue}Description:${colors.reset}`);
        console.log(`   ## Release ${versionBump.newVersion}\n`);
        if (changelogSummary) {
          changelogSummary.split('\n').forEach(line => console.log(`   ${line}`));
        }
        console.log();

        // Show files that would be changed
        console.log(`${colors.blue}Files changed:${colors.reset}\n`);

        // Version manifest files
        for (const pkg of workspace.packages) {
          if (pkg.ecosystem === 'go') continue; // Go has no version manifest
          const manifest = getManifestName(pkg);
          if (pkg.path === workspace.rootPath) {
            console.log(`   ${colors.blue}${manifest}${colors.reset}`);
          } else {
            const relativePath = pkg.path.replace(workspace.rootPath + '/', '');
            console.log(`   ${colors.blue}${relativePath}/${manifest}${colors.reset}`);
          }
          console.log(`     - version: ${pkg.version} → ${versionBump.newVersion}\n`);
        }

        // Changelogs
        const commitsByPackage = groupCommitsByPackage(commits);

        for (const pkg of workspace.packages) {
          const packageCommits = commitsByPackage.get(pkg.name);
          if (packageCommits && packageCommits.length > 0) {
            const relativePath = pkg.path === workspace.rootPath
              ? ''
              : pkg.path.replace(workspace.rootPath + '/', '') + '/';
            console.log(`   ${colors.blue}${relativePath}CHANGELOG.md${colors.reset}`);

            // Generate and display the changelog section
            const changelogContent = generateChangelogSection(versionBump.newVersion!, packageCommits);
            // Indent each line for display
            const lines = changelogContent.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                console.log(`     ${line}`);
              } else {
                console.log();
              }
            }
          }
        }
      }

      process.exit(0);
    }

    // Step 4: Create release branch
    console.log('🌿 Preparing release branch...');
    const releaseBranch = await createReleaseBranch(cwd);
    if (releaseBranch.isNew) {
      console.log(`   Created new branch: ${releaseBranch.name}\n`);
    } else {
      console.log(`   Reusing existing branch: ${releaseBranch.name}\n`);
    }

    // Step 5: Generate changelogs
    console.log('📄 Generating changelogs...');
    await generateChangelogs(
      versionBump.newVersion!,
      commits,
      workspace.packages
    );
    console.log('   Changelogs generated\n');

    // Step 6: Update package versions
    console.log('📝 Updating package versions...');
    await updatePackageVersions(workspace, versionBump.newVersion!);
    console.log('   Package versions updated\n');

    // Step 7: Commit and push
    console.log('💾 Committing and pushing changes...');
    await commitAndPush(cwd, versionBump.newVersion!, true);
    console.log('   Changes pushed to remote\n');

    // Step 8: Create or update PR
    console.log('🔗 Creating/updating pull request...');
    const githubToken = process.env.GITHUB_TOKEN;

    if (!githubToken) {
      console.error(
        '❌ GITHUB_TOKEN environment variable is required to create PR'
      );
      process.exit(1);
    }

    // Build changelog summary for PR body
    const changelogSummary = generatePRSummary(commits);

    const prResult = await createOrUpdatePR(
      cwd,
      releaseBranch.name,
      versionBump.newVersion!,
      changelogSummary,
      githubToken
    );

    if (prResult.isNew) {
      console.log(`   Created new PR: ${prResult.url}\n`);
    } else {
      console.log(`   Updated existing PR: ${prResult.url}\n`);
    }
    console.log('✅ Release process complete!\n');
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
