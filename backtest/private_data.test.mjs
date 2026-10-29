// ELI-778 AC1 and AC2: the backtester moved from the public tradingview-mcp branches without its
// private data. No file git would commit holds a home path or a real chart layout id, and no
// backtest report, trade log or strategy note is committed under backtest/.
// The rules live in private_scan.mjs, and private_scan.test.mjs checks them against known leaks.
// Every check reads the files git would commit, so ignored local run output never fails the suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { committableFiles, findChartIds, findHomePaths, isPrivateBacktestPath } from './private_scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const FILES = committableFiles(ROOT).filter((p) => existsSync(join(ROOT, p)));
const BACKTEST = FILES.filter((p) => p.startsWith('backtest/'));
const text = (p) => readFileSync(join(ROOT, p), 'utf8');

test('no file under backtest/ holds a Windows user folder path', () => {
  const hits = BACKTEST.filter((p) => findHomePaths(text(p)).some((n) => n.startsWith('windows')));
  assert.deepEqual(hits, []);
});

// Review finding: a run of the old store made its Windows home state folder under the repo root, outside backtest/.
// Review finding 1 on PR #10: Linux and macOS home folders and Windows home variables count too.
test('no file git would commit, anywhere in the repo, has a home folder in its path or text', () => {
  const hits = FILES.filter((p) => findHomePaths(p).length || findHomePaths(text(p)).length);
  assert.deepEqual(hits, []);
});

// Review finding 1 on PR #10: the id check covers the whole repo, ids with no trailing slash and env assignments.
test('every chart path in the repo uses a fake chart id', () => {
  const hits = [];
  for (const p of FILES) {
    for (const id of findChartIds(text(p))) hits.push(`${p}: ${id.slice(0, 2)}...`);
  }
  assert.deepEqual(hits, []);
});

test('no backtest report or strategy note is committed under backtest/', () => {
  const notes = BACKTEST.filter(isPrivateBacktestPath);
  assert.deepEqual(notes, []);
});

test('git ignores backtest reports so a run cannot commit one by accident', () => {
  for (const p of ['backtest/mc_basic_1m/findings_2026-10-16.html', 'backtest/mc_b_dot/reports/grid.json', 'backtest/mc_basic_1m/state/trade_log.json']) {
    const r = spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: ROOT });
    assert.equal(r.status, 0, `${p} is not ignored`);
  }
});
