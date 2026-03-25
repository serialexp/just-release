// ABOUTME: Ecosystem adapter interface for multi-language support
// ABOUTME: Defines the contract that JavaScript, Rust, and Go adapters implement

export type EcosystemType = 'javascript' | 'rust' | 'go';

export interface WorkspacePackage {
  name: string;
  version: string;
  path: string;
  ecosystem: EcosystemType;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
) => Promise<ExecResult>;

export interface PublishResult {
  packageName: string;
  success: boolean;
  error?: string;
  warnings?: string[];
}

export interface PublishPrerequisiteResult {
  ready: boolean;
  reason?: string;
}

export interface EcosystemAdapter {
  readonly type: EcosystemType;
  readonly displayName: string;
  readonly manifestFileName: string;

  /** Check whether this ecosystem is present at the given root path. */
  detect(rootPath: string): Promise<boolean>;

  /** Discover all packages/modules/crates in this ecosystem. */
  discoverPackages(rootPath: string): Promise<WorkspacePackage[]>;

  /** Update version numbers in manifest files. No-op for Go. */
  updateVersions(
    rootPath: string,
    newVersion: string,
    packages: WorkspacePackage[]
  ): Promise<void>;

  /** Check whether a package is private (should not be published). */
  isPrivate(packagePath: string): Promise<boolean>;

  /** Check whether prerequisites for publishing are met. */
  checkPublishPrerequisites(rootPath: string): Promise<PublishPrerequisiteResult>;

  /** Publish non-private packages to the ecosystem's registry. */
  publishPackages(
    rootPath: string,
    version: string,
    packages: WorkspacePackage[],
    exec?: ExecFn
  ): Promise<PublishResult[]>;
}
