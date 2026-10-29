// ELI-778 AC1 and AC2: the backtester moved from the public tradingview-mcp branches without its
// private data. No file under backtest/ holds a Windows home path or a real chart layout id, and
// no backtest report or strategy note is committed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
// Chart ids the tests and the fake chart use. Any other id would be a real layout.
const FAKE_CHART_IDS = new Set(['FAKETAB1', 'FAKETAB2', 'Cand1']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const FILES = walk(HERE);
const rel = (f) => relative(ROOT, f).split('\\').join('/');

test('no file under backtest/ holds a Windows user folder path', () => {
  const hits = [];
  for (const f of FILES) {
    const text = readFileSync(f, 'utf8');
    if (/[A-Za-z]:[\\/]+Users[\\/]/i.test(text) || /AppData[\\/]/.test(text)) hits.push(rel(f));
  }
  assert.deepEqual(hits, []);
});

// Review finding: a run of the old store made its Windows home state folder under the repo root, outside backtest/.
test('no file git would commit, anywhere in the repo, has a Windows user folder in its path or text', () => {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const WIN_HOME = /[A-Za-z]:[\\/]+Users[\\/]|AppData[\\/]/i;
  const hits = [];
  for (const p of r.stdout.split('\0').filter(Boolean)) {
    const full = join(ROOT, p);
    if (WIN_HOME.test(p)) hits.push(p);
    else if (existsSync(full) && WIN_HOME.test(readFileSync(full, 'utf8'))) hits.push(p);
  }
  assert.deepEqual(hits, []);
});

test('every chart path under backtest/ uses a fake chart id', () => {
  const hits = [];
  for (const f of FILES) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\/chart\/([A-Za-z0-9]+)\//g)) {
      if (!FAKE_CHART_IDS.has(m[1])) hits.push(`${rel(f)}: ${m[1].slice(0, 2)}...`);
    }
  }
  assert.deepEqual(hits, []);
});

test('no backtest report or strategy note is committed under backtest/', () => {
  const notes = FILES.map(rel).filter((p) => /\.html?$/i.test(p)
    || /master_market_cypher/i.test(p)
    || /(^|\/)handoffs?(\/|$)/i.test(p)
    || /(^|\/)findings[^/]*$/i.test(p));
  assert.deepEqual(notes, []);
});

test('git ignores backtest reports so a run cannot commit one by accident', () => {
  for (const p of ['backtest/mc_basic_1m/findings_2026-10-16.html', 'backtest/mc_b_dot/reports/grid.json', 'backtest/mc_basic_1m/state/trade_log.json']) {
    const r = spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: ROOT });
    assert.equal(r.status, 0, `${p} is not ignored`);
  }
});
