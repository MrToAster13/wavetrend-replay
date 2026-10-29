// ELI-778 AC1: the moved backtester runs from environment settings and loads without the
// tradingview-mcp checkout or the chrome-remote-interface package installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withEnv(name, value, fn) {
  const had = Object.hasOwn(process.env, name);
  const saved = process.env[name];
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
  const restore = () => {
    if (had) process.env[name] = saved;
    else Reflect.deleteProperty(process.env, name);
  };
  return Promise.resolve().then(fn).finally(restore);
}

test('store writes under MC_STATE_DIR', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eli778-state-'));
  try {
    await withEnv('MC_STATE_DIR', dir, async () => {
      const store = await import('./mc_basic_1m/store.mjs');
      store.takeLogLock();
      try { store.createEmptyLog(); } finally { store.releaseLogLock(); }
    });
    assert.equal(existsSync(join(dir, 'trade_log.json')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store refuses to write with E_CONFIG when MC_STATE_DIR is unset', async () => {
  await withEnv('MC_STATE_DIR', undefined, async () => {
    const store = await import('./mc_basic_1m/store.mjs');
    let took = false;
    try {
      assert.throws(() => { store.takeLogLock(); took = true; }, { code: 'E_CONFIG' });
    } finally {
      if (took) store.releaseLogLock();
    }
  });
});

test('collect.mjs and read.mjs load without tradingview-mcp or chrome-remote-interface', async () => {
  const collect = await import('./mc_b_dot/collect.mjs');
  const read = await import('./mc_b_dot/read.mjs');
  assert.equal(typeof collect.parseCollectArgs, 'function');
  assert.equal(typeof read.buildReadExpr, 'function');
});

test('loadTradingViewCore refuses a missing TRADINGVIEW_MCP_DIR', async () => {
  const { loadTradingViewCore } = await import('./mc_b_dot/collect.mjs');
  await assert.rejects(loadTradingViewCore({}), (e) => e.code === 'E_CONFIG' && e.message.includes('TRADINGVIEW_MCP_DIR'));
});

test('loadTradingViewCore imports chart, replay and connection from TRADINGVIEW_MCP_DIR', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eli778-tvmcp-'));
  try {
    mkdirSync(join(dir, 'src', 'core'), { recursive: true });
    writeFileSync(join(dir, 'src', 'core', 'chart.js'), "export const setSymbol = () => 'sym'; export const setTimeframe = () => 'tf';\n");
    writeFileSync(join(dir, 'src', 'core', 'replay.js'), "export const start = () => 'start'; export const stop = () => 'stop';\n");
    writeFileSync(join(dir, 'src', 'connection.js'), "export const disconnect = () => 'bye';\n");
    const { loadTradingViewCore } = await import('./mc_b_dot/collect.mjs');
    const core = await loadTradingViewCore({ TRADINGVIEW_MCP_DIR: dir });
    assert.equal(core.setSymbol(), 'sym');
    assert.equal(core.setTimeframe(), 'tf');
    assert.equal(core.replay.start(), 'start');
    assert.equal(core.replay.stop(), 'stop');
    assert.equal(core.disconnect(), 'bye');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
