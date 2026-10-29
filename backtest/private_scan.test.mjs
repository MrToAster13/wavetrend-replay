// ELI-778 review findings 1 and 2 on PR #10. The private-data rules must catch every leak a run
// could produce, and must skip files git ignores. Leak strings are built from pieces so this file
// does not trip the repo-wide scan in private_data.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { committableFiles, findChartIds, findHomePaths, isPrivateBacktestPath } from './private_scan.mjs';

const ID = 'REAL' + 'ID12';

test('home path rule catches Linux, macOS and Windows home folders', () => {
  for (const text of [
    'MC_STATE_DIR=/ho' + 'me/someone/mc/state',
    'cd /Us' + 'ers/someone/mc',
    'C:\\Us' + 'ers\\someone\\mc',
    'C:/Us' + 'ers/someone/mc',
    '%LOCAL' + 'APPDATA%\\mc_basic_1m\\state',
    '%USER' + 'PROFILE%\\mc',
    'app' + 'data\\local\\mc',
  ]) {
    assert.notDeepEqual(findHomePaths(text), [], text);
  }
});

test('home path rule leaves ordinary paths alone', () => {
  for (const text of ['/tmp/mc', 'backtest/mc_basic_1m/state/', 'https://example.com/homepage/', 'src/users/list.js', '~/.config']) {
    assert.deepEqual(findHomePaths(text), [], text);
  }
});

test('chart id rule catches an id with or without a trailing slash, and an id set in the env', () => {
  assert.deepEqual(findChartIds('https://www.tradingview.com/chart/' + ID), [ID]);
  assert.deepEqual(findChartIds('see /chart/' + ID + '/ for tab 1'), [ID]);
  assert.deepEqual(findChartIds('MC_TAB1_LAYOUT_ID=' + ID), [ID]);
  assert.deepEqual(findChartIds("{ MC_TAB1_LAYOUT_ID: '" + ID + "' }"), [ID]);
});

test('chart id rule allows the fake ids and placeholders', () => {
  for (const text of ['/chart/FAKETAB1/', '/chart/Cand1/', "'/chart/' + tab1() + '/'", '`/chart/${id}/`', '/chart/<MC_TAB1_LAYOUT_ID>/', 'MC_TAB1_LAYOUT_ID=...', "{ MC_TAB1_LAYOUT_ID: 'FAKETAB2' }", "{ MC_TAB1_LAYOUT_ID: '' }", '{ MC_TAB1_LAYOUT_ID: id }']) {
    assert.deepEqual(findChartIds(text), [], text);
  }
});

test('report rule catches reports, trade logs and data files under backtest/', () => {
  for (const p of [
    'backtest/mc_basic_1m/findings_2026-10-16.html',
    'backtest/master_market_cypher.md',
    'backtest/handoffs/a.md',
    'backtest/mc_basic_1m/out/trade_log.json',
    'backtest/mc_basic_1m/backtest_report_2026-10-16.md',
    'backtest/mc_b_dot/data/MES_1m.csv',
    'backtest/mc_b_dot/grid_results.json',
    'backtest/mc_basic_1m/fills.jsonl',
  ]) {
    assert.equal(isPrivateBacktestPath(p), true, p);
  }
});

test('report rule leaves the moved code and docs alone', () => {
  for (const p of ['backtest/README.md', 'backtest/mc_basic_1m/report.mjs', 'backtest/mc_basic_1m/report_write.test.mjs', 'backtest/mc_basic_1m/CONTEXT.md', 'backtest/mc_basic_1m/ADR-chart-session-adapter.md', 'backtest/mc_b_dot/mc_b_dot_strategy.pine']) {
    assert.equal(isPrivateBacktestPath(p), false, p);
  }
});

test('committableFiles lists tracked and untracked files across the repo and skips ignored ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'private_scan_test-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  mkdirSync(join(root, 'backtest', 'state'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'backtest/**/state/\n');
  writeFileSync(join(root, 'backtest', 'state', 'snapshot.json'), '{}');
  writeFileSync(join(root, 'backtest', 'kept.mjs'), '');
  writeFileSync(join(root, 'docs_leak.md'), '');
  const files = committableFiles(root);
  assert.ok(files.includes('backtest/kept.mjs'), files.join(','));
  assert.ok(files.includes('docs_leak.md'), files.join(','));
  assert.ok(!files.includes('backtest/state/snapshot.json'), files.join(','));
});
