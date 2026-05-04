# just-release

The simplest way to release version-synchronized packages on GitHub.

## Philosophy

`just-release` does one thing well: it makes releasing packages with synchronized versions as simple as running a single command.

This tool is **opinionated by design**. It doesn't try to support every weird release workflow - it supports the best one:

- ✅ Conventional commits for automatic version bumping
- ✅ GitHub for source control
- ✅ GitHub Actions for automated releases
- ✅ Per-package changelogs
- ✅ Unified versioning across all packages
- ✅ Works with JavaScript (npm/pnpm/yarn), Rust (Cargo), and Go ecosystems
- ✅ Supports mixed-ecosystem repos (e.g., JS + Rust in the same repo)

`just-release` handles the full lifecycle: version bumping, changelogs, release PRs, publishing to registries (npm, crates.io), and creating GitHub releases.

If this matches your workflow (and it should), `just-release` will make your life easier. If you need something else, this probably isn't the tool for you.

## Features

- 🔍 **Automatic ecosystem detection** - Works with JavaScript, Rust, and Go (including mixed repos)
- 📝 **Conventional commits** - Analyzes commits to determine version bumps
- 📦 **Unified versioning** - All packages in the workspace share the same version
- 📄 **Smart changelogs** - Generates per-package changelogs only for packages with changes
- 🌿 **Git automation** - Creates release branches, commits, and pushes automatically
- 🔗 **GitHub integration** - Creates or updates PRs automatically
- ✂️ **Smart PR truncation** - Progressively truncates large PR bodies to stay within GitHub's 65k character limit
- 🔒 **Dry-run by default** - Safe to run locally without making changes

## Installation

```bash
pnpm add -D just-release
```

Or run directly with npx:

```bash
npx just-release
```

## Usage

### Local Development (Dry-run)

By default, `just-release` runs in dry-run mode when not in a CI environment:

```bash
pnpm just-release
```

This will show you what would happen without making any actual changes.

### CI Environment (Live mode)

Set `CI=1` to execute the release process:

```bash
CI=1 GITHUB_TOKEN=$GITHUB_TOKEN pnpm just-release
```

## How It Works

1. **Detects ecosystems** - Scans for `package.json`, `Cargo.toml`, and/or `go.mod` at the repo root. Discovers all packages across all detected ecosystems.
2. **Resolves current version** - Reads the version from git history: last `release: X.Y.Z` commit → latest `vX.Y.Z` tag → `0.0.0`
3. **Analyzes commits** - Gets all commits since the last release
4. **Calculates version bump** - Based on conventional commit types:
   - `feat:` → minor version bump
   - `fix:` → patch version bump
   - `BREAKING CHANGE:` or `feat!:` → major version bump
   - `chore:`, `docs:` → no release
5. **Generates changelogs** - Creates/updates `CHANGELOG.md` in each affected package
6. **Creates release branch** - Named `release/YYYY-MM-DD`
7. **Updates versions** - Updates version in ecosystem-specific manifest files (`package.json`, `Cargo.toml`; Go versions are purely git tags)
8. **Commits and pushes** - Creates commit with message `release: X.Y.Z`
9. **Creates/updates PR** - Opens or updates a pull request on GitHub

## Supported Ecosystems

### JavaScript (npm/pnpm/yarn)

- Detects `package.json` at root
- Discovers packages from `pnpm-workspace.yaml` or `package.json` `workspaces` field
- Updates `version` in all `package.json` files

### Rust (Cargo)

- Detects `Cargo.toml` at root
- Discovers crates from `[workspace] members` patterns
- Handles `version.workspace = true` inheritance
- Updates `version` in `Cargo.toml` files (preserving formatting and comments)

### Go

- Detects `go.mod` at root
- Discovers modules from `go.work` `use` directives
- Version updates are a no-op — Go versions are purely git tags, which are created automatically by the GitHub release step

### Mixed Repos

If your repo contains multiple ecosystems (e.g., a TypeScript CLI with a Rust native module), `just-release` discovers and processes all of them. Every package shares the same synchronized version.

## Environment Variables

- `CI` - Set to `1` to run in live mode (default: dry-run)
- `GITHUB_TOKEN` - Required for creating/updating PRs (only in live mode)

## Conventional Commit Format

```
<type>: <subject>

<body>

<footer>
```

### Types

- `feat:` - New feature (minor version bump)
- `fix:` - Bug fix (patch version bump)
- `perf:` - Performance improvement (patch version bump)
- `docs:` - Documentation changes (no version bump)
- `chore:` - Maintenance tasks (no version bump)
- `test:` - Test changes (no version bump)

### Breaking Changes

Add `!` after the type or include `BREAKING CHANGE:` in the footer:

```
feat!: remove deprecated API

BREAKING CHANGE: The old API has been removed. Use the new API instead.
```

### Prerelease Versions (alpha, beta, rc)

When the current version contains a prerelease segment (e.g. `0.1.0-alpha.16`),
`just-release` enters **prerelease mode**:

- Every release increments the prerelease counter (`0.1.0-alpha.16 → 0.1.0-alpha.17`).
- Conventional commit types do **not** drive the segment in this mode — `feat`,
  `fix`, even `BREAKING CHANGE` all just bump the counter. Changelogs still
  group commits by type.

#### Graduate to a stable release

Add a `Release-As: stable` footer to any commit since the last release:

```
feat: ready for 1.0

Release-As: stable
```

`0.1.0-alpha.16` → `0.1.0`. Subsequent releases follow normal conventional-commit
rules.

#### Force an exact version

```
chore: bump to 1.0.0

Release-As: 1.0.0
```

#### Start a prerelease cycle from a stable version

Set `JUST_RELEASE_PRERELEASE=<tag>` once when you want to leave stable:

```
JUST_RELEASE_PRERELEASE=alpha just-release
# 1.0.0 + [feat: …]  →  1.1.0-alpha.0
```

After the first prerelease, the env var is no longer needed — counter bumps take
over automatically.

### NAPI sub-package discovery

If a workspace package declares NAPI-RS targets in its `package.json`:

```json
{
  "napi": { "targets": ["x86_64-apple-darwin", "x86_64-unknown-linux-gnu"] }
}
```

…and ships per-platform manifests under `<pkg>/npm/<target>/package.json`,
those sub-packages are auto-discovered and version-locked to the parent. Their
`optionalDependencies` references in the parent manifest are kept in sync.

## Workflow Setup

### GitHub Actions

#### Repository Permissions

**Important:** Your repository (or organization) must allow GitHub Actions to create pull requests, or the workflow will fail.

##### Organization-Level Setting (Recommended)

Set this once for all repositories in your organization:

1. Go to your organization's **Settings** → **Actions** → **General**
2. Scroll to **Workflow permissions**
3. Enable **"Allow GitHub Actions to create and approve pull requests"**

Once enabled at the organization level, this setting will apply to all repositories in the organization (unless individually overridden).

##### Repository-Level Setting

If you're not using organization-level settings, configure each repository individually:

1. Go to your repository's **Settings** → **Actions** → **General**
2. Scroll to **Workflow permissions**
3. Enable **"Allow GitHub Actions to create and approve pull requests"**

**Note:** If your organization disables this setting, the repository-level option will be grayed out. You must enable it at the organization level first.

#### Workflow Configuration

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches:
      - main
  # Manually start a prerelease cycle (alpha/beta/rc) from a stable version.
  # Once the first prerelease lands, subsequent push-triggered runs auto-
  # increment the counter — you don't need to dispatch again.
  workflow_dispatch:
    inputs:
      prerelease:
        description: 'Start a prerelease cycle with this tag (e.g. alpha, beta, rc). Leave blank for a normal release.'
        required: false
        default: ''

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    # Skip if this is a release commit (squash merge) or merge of a release branch (regular merge)
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (!startsWith(github.event.head_commit.message, 'release:') &&
       !(startsWith(github.event.head_commit.message, 'Merge') && contains(github.event.head_commit.message, 'release/')))
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Required to get all commits

      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'

      - run: npx just-release
        env:
          CI: 1
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Only set on workflow_dispatch with a non-empty prerelease input.
          # On push events this is empty and just-release uses normal logic
          # (or auto-counter-bumps if the current version is already a prerelease).
          JUST_RELEASE_PRERELEASE: ${{ github.event.inputs.prerelease }}
```

To **graduate from prerelease back to stable**, you don't need a workflow
input — push a commit with a `Release-As: stable` footer (see
[Prerelease Versions](#prerelease-versions-alpha-beta-rc)) and the next
release run will strip the prerelease segment.

### Publishing

When `just-release` runs in post-release mode (i.e., the current commit is a `release: X.Y.Z` commit), it automatically:

1. **Publishes packages** to their respective registries (npm, crates.io)
2. **Creates a GitHub release** with changelog notes and a `vX.Y.Z` tag

You just need to provide the right environment variables and ensure your project builds before `just-release` runs.

Below are publish workflow examples for each ecosystem.

---

#### Publishing npm Packages

`just-release` detects your package manager (pnpm/yarn/npm) and runs the appropriate publish command. It skips private packages automatically.

**Authentication:** Set `NODE_AUTH_TOKEN` or `NPM_TOKEN` as an environment variable. If neither is set, npm publishing is skipped.

Create `.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    if: >-
      startsWith(github.event.head_commit.message, 'release:') ||
      (startsWith(github.event.head_commit.message, 'Merge') && contains(github.event.head_commit.message, 'release/'))
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install
      - run: pnpm build

      # just-release handles npm publish + GitHub release
      - run: npx just-release
        env:
          CI: 1
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

##### NPM Authentication Options

**Option 1: Trusted Publishing (Recommended)**

Trusted publishing uses OIDC — no npm tokens required. Works with npmjs.org or any registry that supports it.

1. Go to https://www.npmjs.com/package/YOUR-PACKAGE-NAME/access
2. Click "Publishing access" → "Add a trusted publisher"
3. Configure:
   - **Source**: GitHub Actions
   - **Repository owner**: Your GitHub username/org (case-sensitive!)
   - **Repository name**: Your repo name
   - **Workflow filename**: `publish.yml` (optional but recommended)
   - **Environment**: leave blank

**Important:**
- Your repository must be **public** for provenance to work
- `package.json` must have a `repository` field matching your GitHub repo **exactly**:
  - Format: `https://github.com/Owner/repo-name` (no `git+` prefix, no `.git` suffix)
  - Case-sensitive: Owner name must match exactly (e.g., `Aeolun`, not `aeolun`)

**Option 2: NPM Token**

1. Create an npm access token at https://www.npmjs.com/settings/YOUR-USERNAME/tokens
2. Add it as a repository secret named `NPM_TOKEN` in your GitHub repository settings

---

#### Publishing Rust Crates

`just-release` runs `cargo publish` for each non-private crate in workspace order.

**Authentication:** Set `CARGO_REGISTRY_TOKEN` as an environment variable. If not set, Rust publishing is skipped.

Create `.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  publish:
    runs-on: ubuntu-latest
    if: >-
      startsWith(github.event.head_commit.message, 'release:') ||
      (startsWith(github.event.head_commit.message, 'Merge') && contains(github.event.head_commit.message, 'release/'))
    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@stable

      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'

      # just-release handles cargo publish + GitHub release
      - run: npx just-release
        env:
          CI: 1
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

**Note:** If your crates have internal dependencies, `just-release` publishes them in workspace order so dependencies are available on crates.io before dependents are published.

---

#### Publishing Go Modules

Go modules don't need an explicit publish step. The `go` tool resolves modules directly from git tags, and `just-release` creates `vX.Y.Z` tags via the GitHub release.

Create `.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  publish:
    runs-on: ubuntu-latest
    if: >-
      startsWith(github.event.head_commit.message, 'release:') ||
      (startsWith(github.event.head_commit.message, 'Merge') && contains(github.event.head_commit.message, 'release/'))
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'

      # Creates GitHub release with vX.Y.Z tag
      - run: npx just-release
        env:
          CI: 1
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Users can then install your module with:

```bash
go get github.com/your-org/your-module@v1.2.3
```

## PR Body Truncation

GitHub limits PR body text to 65,536 characters. For repositories with many commits since the last release, the PR description is progressively truncated in three tiers:

1. **Full detail** (up to ~40k chars) — Each commit is shown with its hash, type prefix, subject, and full body text
2. **Summary only** (40k–60k chars) — Remaining commits are listed with hash, type prefix, and subject only (no body)
3. **Counts only** (after 60k chars) — Remaining commits are collapsed into a single line: *"...and N more commits (X features, Y fixes, Z chores)"*

This ensures the PR always stays within GitHub's limit while showing as much detail as possible.

## Single-Package vs Monorepo

`just-release` automatically adapts to your repository structure:

- **JavaScript monorepo** - If `pnpm-workspace.yaml` or `package.json` workspaces are found, all workspace packages are bumped to the same version
- **Rust workspace** - If `Cargo.toml` has a `[workspace]` section with `members`, all crates are bumped together
- **Go workspace** - If `go.work` exists, all modules listed in `use` directives are tracked together
- **Single-package** - If no workspace configuration is found, the root package is treated as the only package
- **Mixed ecosystems** - All ecosystems are detected simultaneously. A repo with both `package.json` and `Cargo.toml` will have all packages from both ecosystems versioned together.

## Requirements

- Node.js >= 18
- Git repository with `origin` remote pointing to GitHub
- At least one ecosystem manifest at root: `package.json`, `Cargo.toml`, or `go.mod`
- **Public** GitHub repository (only required if using trusted publishing with provenance for npm)

## License

ISC
