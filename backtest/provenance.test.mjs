// ELI-778 AC3: the backtester keeps no copy of the Market Cipher math. It reads the MarketCipher_B
// and MarketCipher_SR plot values from the TradingView chart, and src/cipher.js stays the one place
// that computes them. Every file copied from tradingview-mcp names its source branch and commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDERS = ['mc_basic_1m', 'mc_b_dot'];
// Files written in wavetrend-replay for ELI-778. Every other file was copied.
const NEW_FILES = new Set([
  'mc_basic_1m/config.mjs',
  'mc_basic_1m/config.test.mjs',
  'mc_basic_1m/draw_guard.test.mjs',
]);
const SOURCE_LINE = /Source: MrToAster13\/tradingview-mcp branch backtest\/(mc-chart-session|mc-basic-1m) at commit ([0-9a-f]{40})/;
const COMMITS = {
  'mc-chart-session': 'afe8081b86474306e6299d28e734b21c0fd88885',
  'mc-basic-1m': '8930382070878495c7e755f3ecc6585cbe715987',
};

const copied = FOLDERS.flatMap((d) => readdirSync(join(HERE, d)).map((n) => `${d}/${n}`))
  .filter((p) => !NEW_FILES.has(p));

test('every copied backtester file names its source branch and commit', () => {
  assert.ok(copied.length >= 40, `only ${copied.length} copied files found`);
  const missing = [];
  for (const p of copied) {
    const m = SOURCE_LINE.exec(readFileSync(join(HERE, p), 'utf8'));
    if (!m || COMMITS[m[1]] !== m[2]) missing.push(p);
  }
  assert.deepEqual(missing, []);
});

test('no backtester file defines its own Market Cipher indicator math', () => {
  const MATH = /(?:function\s+|(?:const|let)\s+)(ema|sma|rma|wma|vwma|hlc3|wavetrend|waveTrend|wt1|wt2|moneyFlow|computeCipher|cipherAt|stochRsi)\s*(?:=|\()/;
  const hits = [];
  for (const p of copied.filter((n) => n.endsWith('.mjs'))) {
    const m = MATH.exec(readFileSync(join(HERE, p), 'utf8'));
    if (m) hits.push(`${p}: ${m[1]}`);
  }
  assert.deepEqual(hits, []);
});
