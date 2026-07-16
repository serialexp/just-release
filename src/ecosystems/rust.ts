// ABOUTME: Rust ecosystem adapter for Cargo workspaces
// ABOUTME: Detects Cargo.toml, discovers workspace crates, updates versions, publishes

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseTOML } from 'smol-toml';
import { glob } from 'glob';
import type {
  EcosystemAdapter,
  WorkspacePackage,
  ExecFn,
  PublishResult,
  PublishPrerequisiteResult,
} from './types.js';
import { defaultExec, binaryExists } from '../exec.js';

export type WaitForIndexFn = (
  crateName: string,
  version: string
) => Promise<void>;

const CRATES_IO_API = 'https://crates.io/api/v1/crates';
const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 16_000;
const TIMEOUT_MS = 120_000;

/**
 * Poll the crates.io API until the given crate version is indexed.
 * Uses exponential backoff: 1s, 2s, 4s, 8s, 16s, 16s, ...
 * Times out after 2 minutes.
 */
export async function waitForCrateIndexed(
  crateName: string,
  version: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch
): Promise<void> {
  const url = `${CRATES_IO_API}/${crateName}/${version}`;
  const deadline = Date.now() + TIMEOUT_MS;
  let delay = INITIAL_DELAY_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const response = await fetchFn(url, {
        headers: { 'User-Agent': 'just-release (https://github.com/ArnoldSmith86/just-release)' },
      });
      if (response.ok) return;
    } catch {
      // Network error — keep retrying
    }

    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }

  throw new Error(
    `Timed out waiting for ${crateName}@${version} to appear on crates.io`
  );
}

/**
 * Topologically sort crates so that dependencies are published before dependents.
 * Uses Kahn's algorithm. Only considers [dependencies] and [build-dependencies],
 * NOT [dev-dependencies].
 */
export function topologicalSortCrates(
  packages: WorkspacePackage[],
  dependencyMap: Map<string, string[]>
): WorkspacePackage[] {
  const packageNames = new Set(packages.map((p) => p.name));
  const packageByName = new Map(packages.map((p) => [p.name, p]));

  // Build adjacency: edge from dependency → dependent
  // inDegree: how many internal deps each package has
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep → [packages that depend on it]

  for (const name of packageNames) {
    inDegree.set(name, 0);
    dependents.set(name, []);
  }

  for (const [name, deps] of dependencyMap) {
    if (!packageNames.has(name)) continue;
    const internalDeps = deps.filter((d) => packageNames.has(d));
    inDegree.set(name, internalDeps.length);
    for (const dep of internalDeps) {
      dependents.get(dep)!.push(name);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: WorkspacePackage[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(packageByName.get(name)!);
    for (const dependent of dependents.get(name)!) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  // If we didn't process all packages, there's a cycle — return what we have
  // plus the remaining in original order
  if (sorted.length < packages.length) {
    const sortedNames = new Set(sorted.map((p) => p.name));
    for (const pkg of packages) {
      if (!sortedNames.has(pkg.name)) sorted.push(pkg);
    }
  }

  return sorted;
}

/**
 * Parse [dependencies] and [build-dependencies] from a Cargo.toml,
 * returning only dependency names (not versions).
 */
export function parseCrateDependencies(cargoContent: string): string[] {
  const cargo = parseTOML(cargoContent) as any;
  const deps: string[] = [];

  if (cargo.dependencies) {
    deps.push(...Object.keys(cargo.dependencies));
  }
  if (cargo['build-dependencies']) {
    deps.push(...Object.keys(cargo['build-dependencies']));
  }

  return deps;
}

export class RustAdapter implements EcosystemAdapter {
  readonly type = 'rust' as const;
  readonly displayName = 'Rust';
  readonly manifestFileName = 'Cargo.toml';

  async detect(rootPath: string): Promise<boolean> {
    try {
      await readFile(join(rootPath, 'Cargo.toml'), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  async discoverPackages(rootPath: string): Promise<WorkspacePackage[]> {
    const rootCargoPath = join(rootPath, 'Cargo.toml');
    const rootContent = await readFile(rootCargoPath, 'utf-8');
    const rootCargo = parseTOML(rootContent) as any;

    // Check for workspace configuration
    const workspaceMembers: string[] = rootCargo.workspace?.members ?? [];

    // Resolve workspace version (used when crates have version.workspace = true)
    const workspaceVersion: string | undefined =
      rootCargo.workspace?.package?.version;

    const packages: WorkspacePackage[] = [];

    if (workspaceMembers.length > 0) {
      // Workspace mode: discover crates from member patterns
      for (const pattern of workspaceMembers) {
        const cratePaths = await glob(pattern, {
          cwd: rootPath,
          absolute: true,
        });

        for (const cratePath of cratePaths) {
          const cargoPath = join(cratePath, 'Cargo.toml');
          let cargoContent: string;
          try {
            cargoContent = await readFile(cargoPath, 'utf-8');
          } catch {
            continue; // Skip if no Cargo.toml in matched directory
          }

          const cargo = parseTOML(cargoContent) as any;
          if (!cargo.package?.name) continue;

          // Resolve version: explicit or inherited from workspace
          let version = cargo.package.version;
          if (typeof version === 'object' && version?.workspace === true) {
            version = workspaceVersion ?? '0.0.0';
          }
          version = version ?? '0.0.0';

          packages.push({
            name: cargo.package.name,
            version,
            path: cratePath,
            ecosystem: 'rust',
          });
        }
      }
    }

    // If no workspace members, treat root as a single crate
    if (packages.length === 0 && rootCargo.package?.name) {
      packages.push({
        name: rootCargo.package.name,
        version: rootCargo.package.version ?? '0.0.0',
        path: rootPath,
        ecosystem: 'rust',
      });
    }

    return packages;
  }

  async updateVersions(
    rootPath: string,
    newVersion: string,
    packages: WorkspacePackage[]
  ): Promise<void> {
    const rustPackages = packages.filter((p) => p.ecosystem === 'rust');
    if (rustPackages.length === 0) return;

    // Update root Cargo.toml (workspace version if present)
    const rootCargoPath = join(rootPath, 'Cargo.toml');
    try {
      const rootContent = await readFile(rootCargoPath, 'utf-8');
      const rootCargo = parseTOML(rootContent) as any;

      let updatedRoot = rootContent;

      // Update [workspace.package] version if present
      if (rootCargo.workspace?.package?.version) {
        updatedRoot = replaceVersionInSection(
          updatedRoot,
          'workspace.package',
          newVersion
        );
      }

      // Update [package] version if root is also a crate
      if (rootCargo.package?.version) {
        const pkgVersion = rootCargo.package.version;
        if (typeof pkgVersion === 'string') {
          updatedRoot = replaceVersionInSection(
            updatedRoot,
            'package',
            newVersion
          );
        }
      }

      if (updatedRoot !== rootContent) {
        await writeFile(rootCargoPath, updatedRoot);
      }
    } catch {
      // Root Cargo.toml doesn't exist or can't be read
    }

    // Update each crate's Cargo.toml
    for (const pkg of rustPackages) {
      if (pkg.path === rootPath) continue; // Already handled above

      const cargoPath = join(pkg.path, 'Cargo.toml');
      const content = await readFile(cargoPath, 'utf-8');
      const cargo = parseTOML(content) as any;

      // Skip crates that inherit version from workspace
      if (
        typeof cargo.package?.version === 'object' &&
        cargo.package.version?.workspace === true
      ) {
        continue;
      }

      // Only update if there's an explicit version string
      if (typeof cargo.package?.version === 'string') {
        const updated = replaceVersionInSection(content, 'package', newVersion);
        if (updated !== content) {
          await writeFile(cargoPath, updated);
        }
      }
    }
  }

  async isPrivate(packagePath: string): Promise<boolean> {
    try {
      const content = await readFile(
        join(packagePath, 'Cargo.toml'),
        'utf-8'
      );
      const cargo = parseTOML(content) as any;
      const publish = cargo.package?.publish;

      // publish = false means explicitly unpublishable
      if (publish === false) return true;

      // publish = [] means no registries allowed (also private)
      if (Array.isArray(publish) && publish.length === 0) return true;

      return false;
    } catch {
      return true; // If we can't read Cargo.toml, treat as private
    }
  }

  async checkPublishPrerequisites(
    _rootPath: string
  ): Promise<PublishPrerequisiteResult> {
    if (!(await binaryExists('cargo'))) {
      return { ready: false, reason: 'cargo is not installed' };
    }

    if (!process.env.CARGO_REGISTRY_TOKEN) {
      return { ready: false, reason: 'CARGO_REGISTRY_TOKEN not set' };
    }

    return { ready: true };
  }

  async publishPackages(
    rootPath: string,
    version: string,
    packages: WorkspacePackage[],
    exec: ExecFn = defaultExec,
    waitForIndex: WaitForIndexFn = waitForCrateIndexed
  ): Promise<PublishResult[]> {
    const rustPackages = packages.filter((p) => p.ecosystem === 'rust');
    if (rustPackages.length === 0) return [];

    // Build dependency map for topological sorting
    const dependencyMap = new Map<string, string[]>();
    for (const pkg of rustPackages) {
      try {
        const content = await readFile(
          join(pkg.path, 'Cargo.toml'),
          'utf-8'
        );
        dependencyMap.set(pkg.name, parseCrateDependencies(content));
      } catch {
        dependencyMap.set(pkg.name, []);
      }
    }

    const sorted = topologicalSortCrates(rustPackages, dependencyMap);
    const results: PublishResult[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const pkg = sorted[i];

      // Wait for previously published crate to be indexed before continuing
      if (i > 0) {
        const prev = sorted[i - 1];
        await waitForIndex(prev.name, version);
      }

      try {
        await exec('cargo', ['publish', '-p', pkg.name], { cwd: rootPath });
        results.push({
          packageName: pkg.name,
          success: true,
          version,
          registry: 'crates.io',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ packageName: pkg.name, success: false, error: message });
        // Fail fast within ecosystem
        break;
      }
    }

    return results;
  }
}

/**
 * Replaces the version field within a specific TOML section.
 * Uses line-by-line scanning to preserve formatting and comments.
 */
function replaceVersionInSection(
  content: string,
  sectionName: string,
  newVersion: string
): string {
  const lines = content.split('\n');
  let currentSection = '';
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track section headers
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    // Look for version = "..." in the target section
    if (!replaced && currentSection === sectionName) {
      const versionMatch = line.match(/^(\s*version\s*=\s*)"[^"]*"(.*)$/);
      if (versionMatch) {
        lines[i] = `${versionMatch[1]}"${newVersion}"${versionMatch[2]}`;
        replaced = true;
      }
    }
  }

  return lines.join('\n');
}
