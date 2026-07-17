// ABOUTME: Fetches the current GitHub Actions run's uploaded artifacts and
// ABOUTME: extracts their files so they can be attached to a release as assets.

import { Octokit } from '@octokit/rest';
import { unzipSync } from 'fflate';
import { basename } from 'node:path';
import type { RepoInfo } from './github.js';

export interface AssetFile {
  name: string;
  data: Buffer;
}

/**
 * Extract every file from a zip archive. Directory entries are skipped. The
 * asset name is the entry's basename — workflow-artifact zips are flat for the
 * common single-file upload, and any nested path collapses to its file name
 * (release asset names can't contain slashes).
 */
export function extractZip(zip: Uint8Array): AssetFile[] {
  const entries = unzipSync(zip);
  const files: AssetFile[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue; // directory entry
    const name = basename(path);
    if (!name) continue;
    files.push({ name, data: Buffer.from(bytes) });
  }
  return files;
}

/**
 * List the workflow run's uploaded artifacts, download each as a zip, and
 * return the extracted files. Every non-expired artifact is included — callers
 * that don't want a file attached to the release simply shouldn't upload it as
 * an artifact in the release run.
 */
export async function collectRunArtifactFiles(
  token: string,
  repoInfo: RepoInfo,
  runId: number
): Promise<AssetFile[]> {
  const octokit = new Octokit({ auth: token });

  const artifacts = await octokit.paginate(
    octokit.actions.listWorkflowRunArtifacts,
    {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      run_id: runId,
      per_page: 100,
    }
  );

  const files: AssetFile[] = [];
  for (const artifact of artifacts) {
    if (artifact.expired) continue;
    const res = await octokit.actions.downloadArtifact({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      artifact_id: artifact.id,
      archive_format: 'zip',
    });
    // Octokit follows the 302 to the signed URL and returns the zip bytes.
    files.push(...extractZip(new Uint8Array(res.data as ArrayBuffer)));
  }
  return files;
}
