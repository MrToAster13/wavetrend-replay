// ELI-778 review findings 1 and 2 on PR #10. The private-data rules must catch every leak a run
// could produce, and must skip files git ignores. Leak strings are built from pieces so this file
// does not trip the repo-wide scan in private_data.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { committableFiles, envForRepoAt, findChartIds, findHomePaths, isPrivateBacktestPath } from './private_scan.mjs';

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
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root, env: envForRepoAt() }).status, 0);
    mkdirSync(join(root, 'backtest', 'state'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'backtest/**/state/\n');
    writeFileSync(join(root, 'backtest', 'state', 'snapshot.json'), '{}');
    writeFileSync(join(root, 'backtest', 'kept.mjs'), '');
    writeFileSync(join(root, 'docs_leak.md'), '');
    const files = committableFiles(root);
    assert.ok(files.includes('backtest/kept.mjs'), files.join(','));
    assert.ok(files.includes('docs_leak.md'), files.join(','));
    assert.ok(!files.includes('backtest/state/snapshot.json'), files.join(','));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ELI-833: the committableFiles test made a temp git repo on every run and never removed it.
// leftoversAfterCommittableFilesTest runs that one test in a child node that inherits parentEnv,
// with its temp folder pointed at a fresh folder, and returns the private_scan_test folders left
// there. PRIVATE_SCAN_CHILD stops the child from running the tests below again.
function leftoversAfterCommittableFilesTest(parentEnv) {
  const tmp = mkdtempSync(join(tmpdir(), 'private_scan_cleanup-'));
  try {
    const env = { ...parentEnv, TMPDIR: tmp, TMP: tmp, TEMP: tmp, PRIVATE_SCAN_CHILD: '1' };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    const args = ['--test-reporter=tap', '--test-name-pattern=^committableFiles lists', fileURLToPath(import.meta.url)];
    const r = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^# pass 1$/m, r.stdout);
    return readdirSync(tmp).filter((n) => n.startsWith('private_scan_test-'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const notInChild = { skip: process.env.PRIVATE_SCAN_CHILD === '1' };

test('a run of the committableFiles test leaves no private_scan_test folder behind', notInChild, () => {
  assert.deepEqual(leftoversAfterCommittableFilesTest(process.env), []);
});

// ELI-833 review finding 1: a test reporter set in NODE_OPTIONS reached the child, which then had
// two reporters and exited with ERR_INVALID_ARG_VALUE before running the committableFiles test.
test('the leftover check still runs when NODE_OPTIONS sets a test reporter', notInChild, () => {
  assert.deepEqual(leftoversAfterCommittableFilesTest({ ...process.env, NODE_OPTIONS: '--test-reporter=spec' }), []);
});

// A pre-commit hook in a git worktree exports GIT_DIR and GIT_INDEX_FILE for that worktree, and
// the hook runs this suite. The committableFiles test then ran `git init` against the hook's
// repo instead of its temp folder, which rewrote the shared config to core.bare = true, and
// listed the hook's repo instead of the temp one.
test('the committableFiles test leaves the repo named by an inherited GIT_DIR alone', notInChild, () => {
  const outer = mkdtempSync(join(tmpdir(), 'private_scan_outer-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q', outer], { env: envForRepoAt() }).status, 0);
    const gitDir = join(outer, '.git');
    const env = { ...process.env, GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, 'index') };
    assert.deepEqual(leftoversAfterCommittableFilesTest(env), []);
    const bare = spawnSync('git', ['-C', outer, 'config', 'core.bare'], { env: envForRepoAt(), encoding: 'utf8' });
    assert.equal(bare.stdout.trim(), 'false');
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

// ELI-1174 review finding 1: the test above ran its own `git init` and `git config` with the
// inherited env, so under a worktree hook it flipped the hook's repo to bare itself. This runs
// the whole file the way a worktree pre-commit hook does, with GIT_DIR and GIT_INDEX_FILE set.
const notInHookChild = { skip: process.env.PRIVATE_SCAN_HOOK_CHILD === '1' };

test('this file run under a worktree hook env leaves the hook repo non-bare', notInHookChild, () => {
  const hookRepo = mkdtempSync(join(tmpdir(), 'private_scan_hook-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q', hookRepo], { env: envForRepoAt() }).status, 0);
    const gitDir = join(hookRepo, '.git');
    const env = { ...process.env, GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, 'index'), PRIVATE_SCAN_HOOK_CHILD: '1' };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    const r = spawnSync(process.execPath, ['--test-reporter=tap', fileURLToPath(import.meta.url)], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const bare = spawnSync('git', ['-C', hookRepo, 'config', 'core.bare'], { env: envForRepoAt(), encoding: 'utf8' });
    assert.equal(bare.stdout.trim(), 'false');
  } finally {
    rmSync(hookRepo, { recursive: true, force: true });
  }
});
