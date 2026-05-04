// ABOUTME: Detects if the current GitHub Actions workflow has its own publish steps
// ABOUTME: Used to skip just-release publishing when the workflow already handles it

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

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

/**
 * Yields the `run:` script body for every step in every job of the workflow.
 * Anything that isn't an actual shell command — YAML comments, `uses:` action
 * references, `with:` arguments, step names, etc. — is excluded by virtue of
 * not being a `run` value, so commentary mentioning `npm publish` doesn't
 * trigger a false match.
 */
function* iterateRunScripts(workflow: unknown): Iterable<string> {
  if (!workflow || typeof workflow !== 'object') return;
  const jobs = (workflow as { jobs?: unknown }).jobs;
  if (!jobs || typeof jobs !== 'object') return;
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    if (!job || typeof job !== 'object') continue;
    const steps = (job as { steps?: unknown }).steps;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const run = (step as { run?: unknown }).run;
      if (typeof run === 'string') yield run;
    }
  }
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

  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    return noMatch;
  }

  const matches: string[] = [];
  for (const rawScript of iterateRunScripts(parsed)) {
    // Skip lines that invoke just-release itself so we don't false-positive
    // on our own invocation, and skip whole-line shell comments inside the
    // run block (e.g. `# npm publish — handled elsewhere`).
    const script = rawScript
      .split('\n')
      .filter((line) => !line.includes('just-release'))
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    for (const pattern of PUBLISH_PATTERNS) {
      const match = script.match(pattern);
      if (match) {
        matches.push(match[0]);
      }
    }
  }

  return {
    hasExternalPublish: matches.length > 0,
    matches,
  };
}
