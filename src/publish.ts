// ABOUTME: Publish orchestrator that coordinates publishing across all ecosystems
// ABOUTME: Filters private packages, checks prerequisites, and collects results

import type {
  EcosystemAdapter,
  WorkspacePackage,
  PublishResult,
  ExecFn,
} from './ecosystems/types.js';

export interface PublishSummary {
  ecosystem: string;
  skipped: boolean;
  skipReason?: string;
  results: PublishResult[];
}

export async function publishAllPackages(
  rootPath: string,
  version: string,
  packages: WorkspacePackage[],
  adapters: EcosystemAdapter[],
  exec?: ExecFn
): Promise<PublishSummary[]> {
  const summaries: PublishSummary[] = [];

  for (const adapter of adapters) {
    // Go publishes via git tags, skip it
    if (adapter.type === 'go') continue;

    // Check prerequisites
    const prereq = await adapter.checkPublishPrerequisites(rootPath);
    if (!prereq.ready) {
      summaries.push({
        ecosystem: adapter.displayName,
        skipped: true,
        skipReason: prereq.reason,
        results: [],
      });
      continue;
    }

    // Filter out private packages
    const ecosystemPackages = packages.filter(
      (p) => p.ecosystem === adapter.type
    );
    const publishable: WorkspacePackage[] = [];
    for (const pkg of ecosystemPackages) {
      if (!(await adapter.isPrivate(pkg.path))) {
        publishable.push(pkg);
      }
    }

    if (publishable.length === 0) {
      summaries.push({
        ecosystem: adapter.displayName,
        skipped: true,
        skipReason: 'No publishable packages (all private)',
        results: [],
      });
      continue;
    }

    // Publish
    const results = await adapter.publishPackages(
      rootPath,
      version,
      publishable,
      exec
    );

    summaries.push({
      ecosystem: adapter.displayName,
      skipped: false,
      results,
    });
  }

  return summaries;
}

export function hasPublishFailures(summaries: PublishSummary[]): boolean {
  return summaries.some((s) =>
    s.results.some((r) => !r.success)
  );
}

/**
 * True when publishing was actually attempted (at least one package) and every
 * attempt failed. Skipped ecosystems (external publish steps, all-private, or
 * missing prerequisites) contribute no results and so never trigger this — a
 * skip is not a failure. Used to abort GitHub release creation when nothing
 * made it to a registry.
 */
export function allPublishesFailed(summaries: PublishSummary[]): boolean {
  const results = summaries.flatMap((s) => s.results);
  return results.length > 0 && results.every((r) => !r.success);
}
