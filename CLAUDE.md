# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`just-release` is an opinionated automated release tool for GitHub repositories (both monorepos and single-package projects). It analyzes conventional commits to determine version bumps, generates per-package changelogs, and creates release PRs automatically.

Philosophy: Does one thing well - makes releasing version-synchronized packages simple. Works with JavaScript (npm/pnpm/yarn), Rust (Cargo), and Go ecosystems, including mixed-ecosystem repos.

### Prerelease behavior

When the current version is a prerelease (e.g. `0.1.0-alpha.16`), the bumper
ignores conventional-commit types and just increments the counter. Two override
signals:

- A commit with a `Release-As: stable` footer graduates to the stable version
  (strips the prerelease segment).
- A commit with `Release-As: <semver>` forces that exact version.
- `JUST_RELEASE_PRERELEASE=<tag>` env var enters a prerelease cycle from a
  stable version once (e.g. `1.0.0 + feat → 1.1.0-alpha.0`).

See `src/version.ts` (`calculateVersionBump`).

### NAPI sub-package discovery

The JS adapter (`src/ecosystems/javascript.ts`) auto-discovers NAPI-RS
per-platform sub-packages under `<pkg>/npm/<target>/package.json` for any
workspace package with a `napi.targets` field. Discovered sub-packages are
treated as ordinary workspace packages — version-locked to the parent and
published alongside it. The same path also rewrites cross-package dep entries
(including `optionalDependencies`) to the new version on bump.

## Development Commands

### Building and Testing
- `pnpm build` - Compile TypeScript to dist/ directory
- `pnpm dev` - Watch mode (continuous compilation)
- `pnpm test` - Run all tests using Node's built-in test runner with tsx
- `node --import tsx --test src/path/to/file.test.ts` - Run a single test file

### Running Locally
- `node dist/cli.js` - Run in dry-run mode (shows what would happen)
- `node dist/cli.js --pr` - Dry-run with PR preview
- `CI=1 GITHUB_TOKEN=xxx node dist/cli.js` - Live mode (executes changes)

Note: Build before running (`pnpm build` first), or use `NO_COLOR=1 node` to disable color output.

## Architecture

The codebase follows a modular, pipeline-based architecture with clear separation of concerns:

### Main Workflow (cli.ts)
Entry point that orchestrates the release process in sequential steps:
1. Detect workspace configuration (across all ecosystems)
2. Resolve current version from git history
3. Analyze commits since last release
4. Calculate version bump
5. Generate changelogs
6. Create/reuse release branch
7. Update version in manifest files (ecosystem-specific)
8. Commit and push
9. Create/update GitHub PR

**Post-release mode**: When run on a commit starting with "release:", automatically creates a GitHub release with changelog notes.

### Ecosystem Adapters (src/ecosystems/)

The ecosystem adapter pattern allows supporting multiple languages. Each adapter implements:
- `detect(rootPath)` - check if the ecosystem is present
- `discoverPackages(rootPath)` - find all packages/crates/modules
- `updateVersions(rootPath, newVersion, packages)` - update version in manifests

**types.ts** - `EcosystemAdapter` interface and `WorkspacePackage` type (with `ecosystem` field)

**javascript.ts** - JavaScript/Node.js adapter
- Detects `package.json`, discovers packages from `pnpm-workspace.yaml` or `package.json` workspaces
- Updates version in `package.json` files

**rust.ts** - Rust/Cargo adapter
- Detects `Cargo.toml`, discovers crates from `[workspace] members`
- Handles `version.workspace = true` inheritance
- Updates version via line-based replacement (preserves formatting/comments)

**go.ts** - Go adapter
- Detects `go.mod`, discovers modules from `go.work` use directives
- `updateVersions` is a no-op (Go versions are purely git tags)

**index.ts** - Orchestrator
- Runs all adapters, merges discovered packages into a single list
- `discoverAllPackages()` and `updateAllVersions()` coordinate across ecosystems

### Core Modules

**workspace.ts** - Workspace Detection
- Delegates to ecosystem adapters via `discoverAllPackages()`
- Resolves current version from git history via `version-source.ts`
- Returns unified workspace info: root version, all packages, detected ecosystems

**version-source.ts** - Git-Based Version Resolution
- Priority: last release commit → latest `vX.Y.Z` git tag → `0.0.0`
- Version is a git-level concept, independent of any ecosystem manifest

**commits.ts** - Commit Analysis
- Fetches git commits since last release (identified by "release: X.Y.Z" commits)
- Parses conventional commit format using `conventional-commits-parser`
- Maps changed files to affected workspace packages
- Detects breaking changes (via `!:` or `BREAKING CHANGE:` footer)
- Returns commits in chronological order (oldest first)
- Validates full git history is available (not shallow clone)

**version.ts** - Version Calculation
- Determines semver bump type based on commit types:
  - Breaking changes → major
  - `feat:` → minor
  - `fix:` or `perf:` → patch
  - `chore:`, `docs:`, etc. → no release
- Returns null bump type if only non-releasable commits

**changelog.ts** - Changelog Generation
- Groups commits by package (based on file changes)
- Generates markdown changelogs per package (only for packages with changes)
- Sections: Breaking Changes, Features, Bug Fixes, Performance, Tests, Docs, Refactoring, Chores, Style, Build, CI
- Prepends new version section to existing CHANGELOG.md

**git.ts** - Git Operations
- Creates or reuses release branches (named `release/YYYY-MM-DD`)
- Delegates version updates to ecosystem adapters
- Auto-configures git user in GitHub Actions if needed
- Force pushes to release branch (to update existing PRs)

**github.ts** - GitHub Integration
- Parses repo owner/name from git remote URL
- Creates or updates PRs for release branches
- Closes old release PRs when creating new ones
- Creates GitHub releases with changelog notes (post-release mode)

**colors.ts** - Terminal Colors
- Provides ANSI color codes for terminal output
- Respects NO_COLOR environment variable and TTY detection

## Key Concepts

### Unified Versioning
All packages in a workspace share the same version, regardless of ecosystem. The version is determined from git history (release commits or tags), not from any ecosystem manifest file.

### Multi-Ecosystem Support
A repo can contain packages from multiple ecosystems simultaneously (e.g., JS + Rust + Go). All packages are discovered and processed uniformly.

### Release Commit Marker
Commits with message "release: X.Y.Z" mark release points. The tool finds commits since the last such marker.

### Dry-Run vs Live Mode
- Default (local): Dry-run mode - shows what would happen without making changes
- `CI=1`: Live mode - executes all git/GitHub operations
- Set `GITHUB_TOKEN` for PR creation in live mode

### Package Change Detection
Commits are mapped to packages by analyzing which files changed. A commit affects a package if any changed file is under that package's directory.

### Release Branch Strategy
- One active release branch at a time (closes old ones when creating new)
- Branches named by date: `release/2024-01-15`
- Reuses existing release branch if found (resets to current main state)
- Force pushes to update the branch (safe because PR is always regenerated)

## Testing

- Tests use Node's built-in test runner (node:test)
- All modules have corresponding `.test.ts` files
- Ecosystem adapters have tests in `src/ecosystems/*.test.ts`
- Tests are excluded from TypeScript compilation (tsconfig.json)
- Run tests with `--import tsx` to handle TypeScript at runtime

## TypeScript Configuration

- ES2022 modules (ESM only, uses .js extensions in imports)
- Strict mode enabled
- Output to dist/ directory
- Generates declaration files and source maps
