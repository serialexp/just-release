// ABOUTME: JavaScript ecosystem adapter for npm/pnpm/yarn workspaces
// ABOUTME: Detects package.json, discovers workspace packages, updates versions, publishes

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { glob } from 'glob';
import type {
  EcosystemAdapter,
  WorkspacePackage,
  ExecFn,
  PublishResult,
  PublishPrerequisiteResult,
} from './types.js';
import { defaultExec, binaryExists } from '../exec.js';

export type JsPackageManager = 'pnpm' | 'yarn' | 'npm';

export async function detectJsPackageManager(
  rootPath: string
): Promise<JsPackageManager> {
  try {
    await access(join(rootPath, 'pnpm-lock.yaml'));
    return 'pnpm';
  } catch {}

  try {
    await access(join(rootPath, 'yarn.lock'));
    return 'yarn';
  } catch {}

  return 'npm';
}

export function getPublishCommand(
  pm: JsPackageManager,
  provenance: boolean = false
): { command: string; args: string[] } {
  switch (pm) {
    case 'pnpm':
      return {
        command: 'pnpm',
        args: ['publish', '--no-git-checks', '--access', 'public', ...(provenance ? ['--provenance'] : [])],
      };
    case 'yarn':
      // Yarn does not support --provenance
      return { command: 'yarn', args: ['npm', 'publish', '--access', 'public'] };
    case 'npm':
      return {
        command: 'npm',
        args: ['publish', '--access', 'public', ...(provenance ? ['--provenance'] : [])],
      };
  }
}

/**
 * Extract the GitHub owner/repo from a package.json repository field.
 * Handles both string shorthand ("github:user/repo", "user/repo")
 * and object form ({ url: "https://github.com/user/repo" }).
 * Returns null if not a recognizable GitHub repository.
 */
export function extractGitHubRepo(
  repository: unknown
): string | null {
  let url: string | undefined;

  if (typeof repository === 'string') {
    url = repository;
  } else if (
    repository &&
    typeof repository === 'object' &&
    'url' in repository &&
    typeof (repository as { url: unknown }).url === 'string'
  ) {
    url = (repository as { url: string }).url;
  }

  if (!url) return null;

  // "github:owner/repo" shorthand
  const shorthand = url.match(/^(?:github:)?([^/]+\/[^/.#]+)$/);
  if (shorthand) return shorthand[1];

  // HTTPS or SSH GitHub URL
  const full = url.match(/github\.com[:/]([^/]+\/[^/.#]+?)(?:\.git)?$/);
  if (full) return full[1];

  return null;
}

/**
 * Check whether a package supports npm provenance.
 * Requires a `repository` field in package.json pointing to the same GitHub
 * repo we're running in, and a supported package manager (npm or pnpm).
 */
export async function checkProvenanceSupport(
  packagePath: string,
  pm: JsPackageManager
): Promise<{ supported: boolean; reason?: string }> {
  if (pm === 'yarn') {
    return { supported: false, reason: 'yarn does not support --provenance' };
  }

  try {
    const content = await readFile(join(packagePath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);
    if (!pkg.repository) {
      return {
        supported: false,
        reason: `package.json is missing a "repository" field (required for npm provenance)`,
      };
    }

    // If running in GitHub Actions, verify the repository field matches
    const ciRepo = process.env.GITHUB_REPOSITORY;
    if (ciRepo) {
      const pkgRepo = extractGitHubRepo(pkg.repository);
      if (!pkgRepo) {
        return {
          supported: false,
          reason: `package.json "repository" does not point to a GitHub repo (required for npm provenance)`,
        };
      }
      if (pkgRepo !== ciRepo) {
        return {
          supported: false,
          reason: `package.json "repository" (${pkgRepo}) doesn't match the current GitHub repo (${ciRepo}) — can't use --provenance`,
        };
      }
    }

    return { supported: true };
  } catch {
    return { supported: false, reason: 'could not read package.json' };
  }
}

export class JavaScriptAdapter implements EcosystemAdapter {
  readonly type = 'javascript' as const;
  readonly displayName = 'JavaScript';
  readonly manifestFileName = 'package.json';

  async detect(rootPath: string): Promise<boolean> {
    try {
      await readFile(join(rootPath, 'package.json'), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  async discoverPackages(rootPath: string): Promise<WorkspacePackage[]> {
    const rootPackageJsonPath = join(rootPath, 'package.json');
    const rootContent = await readFile(rootPackageJsonPath, 'utf-8');
    const rootPackageJson = JSON.parse(rootContent);

    // Try to read pnpm-workspace.yaml first
    let workspacePatterns: string[] = [];

    try {
      const pnpmWorkspacePath = join(rootPath, 'pnpm-workspace.yaml');
      const pnpmContent = await readFile(pnpmWorkspacePath, 'utf-8');
      const pnpmConfig = parseYaml(pnpmContent);
      workspacePatterns = pnpmConfig.packages || [];
    } catch {
      // If pnpm-workspace.yaml doesn't exist, try package.json workspaces
      if (rootPackageJson.workspaces) {
        workspacePatterns = Array.isArray(rootPackageJson.workspaces)
          ? rootPackageJson.workspaces
          : rootPackageJson.workspaces.packages || [];
      }
    }

    const packages: WorkspacePackage[] = [];

    for (const pattern of workspacePatterns) {
      const packagePaths = await glob(join(pattern, 'package.json'), {
        cwd: rootPath,
        absolute: true,
      });

      for (const packageJsonPath of packagePaths) {
        const packageContent = await readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageContent);
        const packagePath = packageJsonPath.replace(/\/package\.json$/, '');

        packages.push({
          name: packageJson.name,
          version: packageJson.version,
          path: packagePath,
          ecosystem: 'javascript',
        });
      }
    }

    // If no workspace packages found, treat root as the package
    if (packages.length === 0) {
      packages.push({
        name: rootPackageJson.name,
        version: rootPackageJson.version || '0.0.0',
        path: rootPath,
        ecosystem: 'javascript',
      });
    }

    return packages;
  }

  async updateVersions(
    rootPath: string,
    newVersion: string,
    packages: WorkspacePackage[]
  ): Promise<void> {
    const jsPackages = packages.filter((p) => p.ecosystem === 'javascript');

    // Update root package.json
    const rootPkgPath = join(rootPath, 'package.json');
    const rootContent = await readFile(rootPkgPath, 'utf-8');
    const rootPackage = JSON.parse(rootContent);
    rootPackage.version = newVersion;
    await writeFile(rootPkgPath, JSON.stringify(rootPackage, null, 2) + '\n');

    // Update workspace packages (skip root if it's in the packages list)
    for (const pkg of jsPackages) {
      if (pkg.path === rootPath) {
        continue;
      }

      const pkgPath = join(pkg.path, 'package.json');
      const pkgContent = await readFile(pkgPath, 'utf-8');
      const pkgJson = JSON.parse(pkgContent);
      pkgJson.version = newVersion;
      await writeFile(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n');
    }
  }

  async isPrivate(packagePath: string): Promise<boolean> {
    try {
      const content = await readFile(join(packagePath, 'package.json'), 'utf-8');
      const pkg = JSON.parse(content);
      return pkg.private === true;
    } catch {
      return true; // If we can't read the package.json, treat as private
    }
  }

  async checkPublishPrerequisites(
    rootPath: string
  ): Promise<PublishPrerequisiteResult> {
    const pm = await detectJsPackageManager(rootPath);

    if (!(await binaryExists(pm))) {
      return { ready: false, reason: `${pm} is not installed` };
    }

    if (!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN) {
      return {
        ready: false,
        reason: 'NODE_AUTH_TOKEN (or NPM_TOKEN) not set',
      };
    }

    return { ready: true };
  }

  async publishPackages(
    rootPath: string,
    _version: string,
    packages: WorkspacePackage[],
    exec: ExecFn = defaultExec
  ): Promise<PublishResult[]> {
    const jsPackages = packages.filter((p) => p.ecosystem === 'javascript');
    const pm = await detectJsPackageManager(rootPath);
    const results: PublishResult[] = [];

    for (const pkg of jsPackages) {
      const warnings: string[] = [];
      const provenance = await checkProvenanceSupport(pkg.path, pm);
      if (!provenance.supported) {
        warnings.push(`Publishing ${pkg.name} without provenance: ${provenance.reason}`);
      }

      const { command, args } = getPublishCommand(pm, provenance.supported);

      try {
        await exec(command, args, { cwd: pkg.path });
        results.push({
          packageName: pkg.name,
          success: true,
          ...(warnings.length > 0 ? { warnings } : {}),
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
