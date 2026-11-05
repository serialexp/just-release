// ABOUTME: Builds Octokit clients aimed at the API the workflow runs against
// ABOUTME: Honors GITHUB_API_URL so GitHub Enterprise and Gothab-compatible hosts work

import { Octokit } from '@octokit/rest';

type OctokitOptions = ConstructorParameters<typeof Octokit>[0];

/**
 * The REST base URL for this run. CI sets `GITHUB_API_URL` (github.com's is
 * `https://api.github.com`; a GitHub Enterprise or compatible host sets its
 * own), so reading it keeps github.com behavior identical while letting the
 * same workflow run elsewhere.
 */
export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.GITHUB_API_URL?.trim();
  return url ? url.replace(/\/+$/, '') : undefined;
}

export function createOctokit(token: string, options: OctokitOptions = {}): Octokit {
  return new Octokit({ ...options, auth: token, baseUrl: apiBaseUrl() });
}

/**
 * A release's `upload_url` is an RFC 6570 template
 * (`.../assets{?name,label}`). Octokit's upload call hard-codes
 * uploads.github.com unless given the concrete URL, which only the release
 * itself knows on a host that serves uploads from its own API origin.
 */
export function uploadUrlFor(uploadUrlTemplate: string): string {
  return uploadUrlTemplate.replace(/\{\?[^}]*\}$/, '');
}
