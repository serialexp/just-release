// ABOUTME: Detects if the current GitHub Actions workflow has its own publish steps
// ABOUTME: Used to skip just-release publishing when the workflow already handles it

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PUBLISH_PATTERNS = [
  /\bnpm\s+publish\b/,
  /\bpnpm\s+publish\b/,
  /\byarn\s+(npm\s+)?publish\b/,
  /\bcargo\s+publish\b/,
];

export interface WorkflowPublishCheck {
  hasExternalPublish: boolean;
  matches: string[];
}

export async function detectWorkflowPublishSteps(
  cwd: string,
  env: Record<string, string | undefined> = process.env
): Promise<WorkflowPublishCheck> {
  const noMatch: WorkflowPublishCheck = { hasExternalPublish: false, matches: [] };

  if (!env.GITHUB_ACTIONS) return noMatch;

  const workflowRef = env.GITHUB_WORKFLOW_REF;
  if (!workflowRef) return noMatch;

  // GITHUB_WORKFLOW_REF looks like: owner/repo/.github/workflows/release.yml@refs/heads/main
  const atIndex = workflowRef.indexOf('@');
  const refPath = atIndex >= 0 ? workflowRef.slice(0, atIndex) : workflowRef;
  // Extract path after the first owner/repo segment
  const slashAfterOwner = refPath.indexOf('/', refPath.indexOf('/') + 1);
  if (slashAfterOwner < 0) return noMatch;
  const workflowPath = refPath.slice(slashAfterOwner + 1);

  let content: string;
  try {
    content = await readFile(join(cwd, workflowPath), 'utf-8');
  } catch {
    return noMatch;
  }

  // Strip lines that run just-release itself so we don't false-positive on our own invocation
  const lines = content.split('\n').filter(
    (line) => !line.includes('just-release')
  );
  const filtered = lines.join('\n');

  const matches: string[] = [];
  for (const pattern of PUBLISH_PATTERNS) {
    const match = filtered.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }

  return {
    hasExternalPublish: matches.length > 0,
    matches,
  };
}
