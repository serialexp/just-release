import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generatePRSummary, getCommitPrefix } from './formatting.js';
import { CommitInfo } from './commits.js';

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc1234',
    type: 'feat',
    scope: null,
    subject: 'add feature',
    body: null,
    breaking: false,
    packages: ['root'],
    files: ['src/index.ts'],
    rawMessage: 'feat: add feature',
    releaseAs: null,
    ...overrides,
  };
}

describe('getCommitPrefix', () => {
  it('returns breaking prefix for breaking commits', () => {
    assert.strictEqual(getCommitPrefix(makeCommit({ breaking: true })), '⚠️ BREAKING: ');
  });

  it('returns correct prefix for each type', () => {
    assert.strictEqual(getCommitPrefix(makeCommit({ type: 'feat' })), '✨ ');
    assert.strictEqual(getCommitPrefix(makeCommit({ type: 'fix' })), '🐛 ');
    assert.strictEqual(getCommitPrefix(makeCommit({ type: 'perf' })), '⚡ ');
    assert.strictEqual(getCommitPrefix(makeCommit({ type: 'chore' })), '🔧 ');
  });

  it('returns unknown prefix for null type', () => {
    assert.strictEqual(getCommitPrefix(makeCommit({ type: null })), '❓ ');
  });
});

describe('generatePRSummary', () => {
  it('renders a single commit with body', () => {
    const commits = [makeCommit({ body: 'Some details\nabout the change' })];
    const result = generatePRSummary(commits);
    assert.ok(result.includes('abc1234'));
    assert.ok(result.includes('✨ '));
    assert.ok(result.includes('add feature'));
    assert.ok(result.includes('  Some details'));
    assert.ok(result.includes('  about the change'));
  });

  it('renders a commit without body', () => {
    const commits = [makeCommit()];
    const result = generatePRSummary(commits);
    assert.ok(result.includes('abc1234'));
    assert.ok(result.includes('add feature'));
    assert.ok(!result.includes('  '));
  });

  it('uses rawMessage when subject is null', () => {
    const commits = [makeCommit({ subject: null, rawMessage: 'raw msg here' })];
    const result = generatePRSummary(commits);
    assert.ok(result.includes('raw msg here'));
  });

  it('stays under full detail limit with small input', () => {
    const commits = Array.from({ length: 10 }, (_, i) =>
      makeCommit({ hash: `hash${i}`, subject: `feature ${i}` })
    );
    const result = generatePRSummary(commits);
    assert.ok(result.length < 40_000);
    // Should not contain truncation markers
    assert.ok(!result.includes('---'));
    assert.ok(!result.includes('more commits'));
  });

  it('switches to summary-only after 40k characters', () => {
    // Create commits with large bodies to push past 40k
    const longBody = 'x'.repeat(500);
    const commits = Array.from({ length: 200 }, (_, i) =>
      makeCommit({
        hash: `hash${String(i).padStart(4, '0')}`,
        subject: `feature number ${i}`,
        body: longBody,
      })
    );

    const result = generatePRSummary(commits);

    // Should contain the summary-only transition marker
    assert.ok(result.includes('Remaining commits shown without details'));

    // After the marker, there should be lines without the indented body
    const parts = result.split('---');
    assert.strictEqual(parts.length, 2);
    const summarySection = parts[1];

    // The summary section should have commit lines but no indented body lines
    const summaryLines = summarySection.split('\n').filter(l => l.startsWith('- '));
    assert.ok(summaryLines.length > 0, 'should have summary-only commit lines');
  });

  it('shows remainder counts after 60k characters', () => {
    // Create enough commits to exceed 60k even with summary-only lines
    // ~40k full detail + need >20k of summary lines to hit 60k
    // Each summary line is ~100 chars, so 200+ summary lines = 20k+
    const longBody = 'y'.repeat(1000);
    const commits: CommitInfo[] = [];

    // Mix of types so we can verify the count breakdown
    for (let i = 0; i < 500; i++) {
      commits.push(
        makeCommit({
          hash: `hash${String(i).padStart(4, '0')}`,
          subject: `feature number ${i} with a reasonably long description to take up space in the PR body text`,
          body: longBody,
          type: i % 3 === 0 ? 'feat' : i % 3 === 1 ? 'fix' : 'chore',
        })
      );
    }

    const result = generatePRSummary(commits);

    // Should contain the "...and N more commits" message
    assert.ok(result.includes('more commits'), 'should have remainder message');
    // Should mention type counts
    assert.ok(
      result.includes('features') || result.includes('fixes') || result.includes('chores'),
      'should include type labels in remainder'
    );
    // Must stay under GitHub's 65k limit
    assert.ok(result.length < 65_536, `result length ${result.length} should be under 65536`);
  });

  it('never exceeds 65k characters even with huge input', () => {
    const hugeBody = 'z'.repeat(2000);
    const commits = Array.from({ length: 500 }, (_, i) =>
      makeCommit({
        hash: `hash${String(i).padStart(4, '0')}`,
        subject: `commit ${i} with a long subject line that takes up some characters in the output`,
        body: hugeBody,
        type: 'feat',
      })
    );

    const result = generatePRSummary(commits);
    assert.ok(result.length < 65_536, `result length ${result.length} should be under 65536`);
  });

  it('handles empty commits array', () => {
    const result = generatePRSummary([]);
    assert.strictEqual(result, '');
  });
});
