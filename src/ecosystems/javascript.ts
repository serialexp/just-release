// ABOUTME: JavaScript ecosystem adapter for npm/pnpm/yarn workspaces
// ABOUTME: Detects package.json, discovers workspace packages, updates versions, publishes

import { readFile, writeFile, access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { glob } from 'glob';
import semver from 'semver';
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

/**
 * Derive the npm dist-tag for a given semver. Stable releases publish under
 * the default `latest` tag (no `--tag` argument needed). Prereleases must
 * publish under a non-`latest` tag — otherwise `npm publish` either errors
 * (newer npm) or silently moves `latest` to the prerelease (older npm),
 * which would shadow the stable release for unsuspecting installers.
 *
 * Returns the prerelease identifier when present (e.g. `0.1.0-alpha.18` →
 * `alpha`). Falls back to `'prerelease'` when the version is a prerelease
 * with no string identifier (e.g. `1.0.0-0`). Returns null for stable.
 */
export function getPrereleaseDistTag(version: string): string | null {
  const pre = semver.prerelease(version);
  if (!pre || pre.length === 0) return null;
  return typeof pre[0] === 'string' ? pre[0] : 'prerelease';
}

export function getPublishCommand(
  pm: JsPackageManager,
  provenance: boolean = false,
  version?: string
): { command: string; args: string[] } {
  const distTag = version ? getPrereleaseDistTag(version) : null;
  const tagArgs = distTag ? ['--tag', distTag] : [];
  switch (pm) {
    case 'pnpm':
      return {
        command: 'pnpm',
        args: [
          'publish',
          '--no-git-checks',
          '--access',
          'public',
          ...tagArgs,
          ...(provenance ? ['--provenance'] : []),
        ],
      };
    case 'yarn':
      // Yarn does not support --provenance
      return {
        command: 'yarn',
        args: ['npm', 'publish', '--access', 'public', ...tagArgs],
      };
    case 'npm':
      return {
        command: 'npm',
        args: [
          'publish',
          '--access',
          'public',
          ...tagArgs,
          ...(provenance ? ['--provenance'] : []),
        ],
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

export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org';

/**
 * Determine the registry a package publishes to. Honours
 * `publishConfig.registry` in the package's own package.json (the value npm
 * itself consults), falling back to the public npm registry.
 */
export async function getPublishRegistry(
  packagePath: string
): Promise<string> {
  try {
    const content = await readFile(join(packagePath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);
    const registry = pkg?.publishConfig?.registry;
    if (typeof registry === 'string' && registry.length > 0) {
      return registry;
    }
  } catch {}
  return DEFAULT_NPM_REGISTRY;
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

    // NAPI per-platform sub-packages: a workspace package with `napi.targets`
    // and an `npm/` directory ships an extra package.json per target. Lock-step
    // them with the parent so they get the same version + can be published.
    for (const parent of packages.slice()) {
      const parentManifestPath = join(parent.path, 'package.json');
      let parentManifest: any;
      try {
        parentManifest = JSON.parse(await readFile(parentManifestPath, 'utf-8'));
      } catch {
        continue;
      }
      if (!parentManifest.napi?.targets) continue;

      const npmDir = join(parent.path, 'npm');
      try {
        const s = await stat(npmDir);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const subPaths = await glob('*/package.json', {
        cwd: npmDir,
        absolute: true,
      });
      for (const subPath of subPaths) {
        let subPkg: any;
        try {
          subPkg = JSON.parse(await readFile(subPath, 'utf-8'));
        } catch {
          continue;
        }
        if (!subPkg.name) continue;
        packages.push({
          name: subPkg.name,
          version: subPkg.version,
          path: subPath.replace(/\/package\.json$/, ''),
          ecosystem: 'javascript',
        });
      }
    }

    return packages;
  }

  async updateVersions(
    rootPath: string,
    newVersion: string,
    packages: WorkspacePackage[]
  ): Promise<void> {
    const jsPackages = packages.filter((p) => p.ecosystem === 'javascript');

    // Build a set of all known workspace package names so we can rewrite
    // cross-package dep entries to the new version (keeps optionalDependencies
    // for NAPI sub-packages, peerDependencies between workspace plugins, etc.
    // in lock-step without special-casing each consumer).
    const knownNames = new Set(jsPackages.map((p) => p.name).filter(Boolean));
    const depKeys = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ] as const;

    function rewriteWorkspaceDeps(manifest: any): void {
      for (const key of depKeys) {
        const deps = manifest[key];
        if (!deps || typeof deps !== 'object') continue;
        for (const name of Object.keys(deps)) {
          if (!knownNames.has(name)) continue;
          const current = deps[name];
          // Preserve `workspace:*` / `workspace:^` style protocol entries —
          // those resolve at install/publish time and don't need rewriting.
          if (typeof current === 'string' && current.startsWith('workspace:')) continue;
          deps[name] = newVersion;
        }
      }
    }

    // Update root package.json
    const rootPkgPath = join(rootPath, 'package.json');
    const rootContent = await readFile(rootPkgPath, 'utf-8');
    const rootPackage = JSON.parse(rootContent);
    rootPackage.version = newVersion;
    rewriteWorkspaceDeps(rootPackage);
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
      rewriteWorkspaceDeps(pkgJson);
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

    // Auth is intentionally NOT gated here. The recommended path is npm
    // trusted publishing (OIDC): grant `id-token: write` in the workflow
    // and configure a trusted publisher on npmjs.com — the npm CLI then
    // exchanges the OIDC token for a short-lived publish token with no
    // involvement from us. If a legacy `NODE_AUTH_TOKEN` is present in
    // the environment, npm picks it up on its own. Either way,
    // just-release neither inspects nor requires an npm token.
    return { ready: true };
  }

  async publishPackages(
    rootPath: string,
    version: string,
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

      const { command, args } = getPublishCommand(pm, provenance.supported, version);
      const registry = await getPublishRegistry(pkg.path);

      try {
        await exec(command, args, { cwd: pkg.path });
        results.push({
          packageName: pkg.name,
          success: true,
          version,
          registry,
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
