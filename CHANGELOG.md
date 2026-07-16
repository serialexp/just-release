# Changelog

## 0.14.0 (2026-07-16)

### Features

- show registry and version in publish output

## 0.13.6 (2026-07-16)

### Bug Fixes

- parse Release-As footer and anchor range to latest tag
- prefer a valid Release-As footer over keyword prose

## 0.13.5 (2026-05-04)

### Bug Fixes

- anchor release-commit detection to subject start

## 0.13.4 (2026-05-04)

### Bug Fixes

- pass --tag <prerelease-id> to npm publish for prereleases

## 0.13.3 (2026-05-04)

### Bug Fixes

- suppress noisy 404 from GitHub release existence probe
- only inspect run scripts, not raw file text

### Chores

- bump GitHub Actions to Node 24-compatible versions

## 0.13.2 (2026-05-04)

### Bug Fixes

- force initial branch to main in post-release fixture
- stop gating npm publish on NPM_TOKEN; recommend trusted publishing only

## 0.13.1 (2026-05-04)

### Bug Fixes

- accept GitHub OIDC env vars as npm auth (trusted publishing)

### Documentation

- show workflow_dispatch input for starting prerelease cycle

## 0.13.0 (2026-05-04)

### Features

- prerelease lifecycle, NAPI sub-package discovery, manifest version fallback

## 0.12.0 (2026-04-23)

### Features

- skip publishing when workflow already has publish steps

## 0.11.0 (2026-03-25)

### Features

- add npm provenance support and simplify publish workflow

## 0.10.0 (2026-03-19)

### Features

- treat all commit types as releasable

### Bug Fixes

- only match release/YYYY-MM-DD branches as valid release branches

### Documentation

- update publish workflows to reflect built-in publishing

## 0.9.1 (2026-03-09)

### Bug Fixes

- update dependencies

## 0.9.0 (2026-02-20)

### Features

- add multi-ecosystem adapter pattern and auto-publish in post-release mode

## 0.8.5 (2026-02-20)

### Bug Fixes

- update repository URL to new location

## 0.8.4 (2026-02-20)

### Bug Fixes

- use GitHub-hosted runner for npm trusted publishing

### Chores

- update project documentation

## 0.8.3 (2026-02-20)

### Bug Fixes

- add version display and debug logging for post-release detection
- only detect post-release from HEAD or its merge parents

### Chores

- switch CI runners to depot-ubuntu-latest
- simplify smoke test to plain CLI run
- add separate output verification step to smoke test
- consolidate smoke test into single step

## 0.8.2 (2026-02-17)

### Bug Fixes

- support both squash and regular merge for release PRs
- truncate PR body to stay within GitHub's 65k character limit

### Chores

- update to Node LTS, pnpm/action-setup@v4, add packageManager field

## 0.8.1 (2026-02-10)

### Bug Fixes

- extract formatting to own module to fix CLI not running

## 0.8.0 (2026-02-10)

### Features

- support non-conventional commits in changelog, PR summary, and display

### Chores

- add CLAUDE.md and gitignore package-lock.json

## 0.7.0 (2026-01-12)

### Features

- update existing GitHub release instead of failing

### Documentation

- add npm token publishing option
- add GitHub release step to publish workflow examples
- add contents:write permission to npm token workflow

## 0.6.0 (2025-11-18)

### Features

- support flexible release commit formats

### Documentation

- clarify trusted publishing is the only supported method
- clarify custom registries are supported
- add GitHub Actions PR creation permissions requirement
- add example CI workflow that skips release commits
- clarify repository field format requirements for provenance
- skip Release workflow on release commits
- remove CI workflow example

### Chores

- ignore local Claude settings

## 0.5.2 (2025-11-13)

### Bug Fixes

- add repository field to package.json for provenance

## 0.5.1 (2025-11-13)

### Bug Fixes

- remove extra permissions instance
- upgrade npm for provenance support on GitHub runners

## 0.5.0 (2025-11-13)

### Features

- use OIDC for npm authentication instead of token

## 0.4.1 (2025-11-13)

### Bug Fixes

- set permissions at job level for OIDC token

## 0.4.0 (2025-11-13)

### Features

- automatically create GitHub releases
- require full git history, fail on shallow clones
- context-aware error for shallow clones
- clarify branch creation vs reuse in output
- enable npm provenance for trusted publishing

### Bug Fixes

- reuse existing release branch and PR
- check remote branches when looking for existing release branch
- create release branch before making file changes
- close old release PRs when creating a new one

### Performance Improvements

- optimize commit history search with staggered fetching

### Documentation

- clarify opinionated philosophy in README
- clarify package manager support

## 0.3.0 (2025-11-12)

### Features

- add manual trigger to workflows

### Chores

- rename package to just-release

## 0.2.0 (2025-11-11)

### Features

- add support for single-package repos
- clarify messaging for single-package repos
- add colored path for single-package repo message
- show commit type summary after analyzing commits
- respect NO_COLOR and terminal capabilities
- format commit type summary with indented bullets
- show release branch name in dry-run summary
- add --pr flag to preview pull request content
- include all commit types in changelog
- include all commit types in PR description
- add GitHub Actions workflows for release automation
- auto-configure git in GitHub Actions
- include full commit SHA in PR description
- include commit body in PR description
- add blank line between commit title and body in PR

### Bug Fixes

- use node dist/cli.js instead of pnpm mono-release
- parse full commit message including body

### Tests

- add comprehensive color detection tests

### Chores

- initial commit

