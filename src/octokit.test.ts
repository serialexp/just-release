// ABOUTME: Tests for API base URL resolution and upload URL handling
// ABOUTME: Validates GITHUB_API_URL support and upload_url template expansion

import { test } from 'node:test';
import assert from 'node:assert';
import { apiBaseUrl, uploadUrlFor } from './octokit.js';

test('apiBaseUrl uses GITHUB_API_URL without a trailing slash', () => {
  assert.strictEqual(
    apiBaseUrl({ GITHUB_API_URL: 'https://gothab.io/api/v3/' }),
    'https://gothab.io/api/v3'
  );
  assert.strictEqual(apiBaseUrl({ GITHUB_API_URL: '' }), undefined);
  assert.strictEqual(apiBaseUrl({}), undefined);
});

test('uploadUrlFor strips the RFC 6570 query template', () => {
  assert.strictEqual(
    uploadUrlFor('https://gh-api.gothab.io/repos/o/r/releases/7/assets{?name,label}'),
    'https://gh-api.gothab.io/repos/o/r/releases/7/assets'
  );
  assert.strictEqual(
    uploadUrlFor('https://uploads.github.com/repos/o/r/releases/7/assets'),
    'https://uploads.github.com/repos/o/r/releases/7/assets'
  );
});
