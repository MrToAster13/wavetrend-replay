/*
 * ELI-778 AC1: the chart layout id and the state folder come from environment variables, not
 * from constants in the code. config.mjs reads them; cdp.mjs and store.mjs use config.mjs.
 * Tests pass an env object, so nothing here reads the real environment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_NAMES, tab1LayoutId, stateDirFrom } from './config.mjs';

const FOLDER = dirname(fileURLToPath(import.meta.url));
// Built from parts so lint.test.mjs does not read these lines as imports of this file.
const IMPORT_WORD = ['imp', 'ort'].join('');

test('the layout id comes from MC_TAB1_LAYOUT_ID', () => {
  assert.equal(ENV_NAMES.layout, 'MC_TAB1_LAYOUT_ID');
  assert.equal(tab1LayoutId({ MC_TAB1_LAYOUT_ID: 'AbC123xy' }), 'AbC123xy');
});

test('a missing or empty layout id is E_CONFIG and names the variable', () => {
  for (const env of [{}, { MC_TAB1_LAYOUT_ID: '' }]) {
    assert.throws(() => tab1LayoutId(env), (e) => e.code === 'E_CONFIG' && e.message.includes('MC_TAB1_LAYOUT_ID'));
  }
});

test('a layout id that is not letters and digits is E_CONFIG', () => {
  for (const id of ['ab/cd', '../x', 'ab cd', 'ab"cd', '/chart/FAKETAB1/']) {
    assert.throws(() => tab1LayoutId({ MC_TAB1_LAYOUT_ID: id }), { code: 'E_CONFIG' }, id);
  }
});

test('the state folder comes from MC_STATE_DIR and must be absolute', () => {
  assert.equal(ENV_NAMES.stateDir, 'MC_STATE_DIR');
  const abs = join(FOLDER, 'state-folder');
  assert.equal(stateDirFrom({ MC_STATE_DIR: abs }), abs);
  for (const env of [{}, { MC_STATE_DIR: '' }, { MC_STATE_DIR: 'relative/state' }]) {
    assert.throws(() => stateDirFrom(env), (e) => e.code === 'E_CONFIG' && e.message.includes('MC_STATE_DIR'));
  }
});

test('cdp.mjs takes the tab 1 layout id from config.mjs and holds no chart id of its own', () => {
  const text = readFileSync(join(FOLDER, 'cdp.mjs'), 'utf8');
  assert.ok(text.includes(`${IMPORT_WORD} { tab1LayoutId } from './config.mjs';`), 'cdp.mjs does not import tab1LayoutId');
  assert.equal(/\/chart\/[A-Za-z0-9]+\//.test(text), false, 'cdp.mjs names a chart path');
  assert.equal(/TAB1_ID = '/.test(text), false, 'cdp.mjs pins a layout id constant');
});

test('store.mjs takes its state folder from config.mjs and holds no folder of its own', () => {
  const text = readFileSync(join(FOLDER, 'store.mjs'), 'utf8');
  assert.ok(text.includes(`${IMPORT_WORD} { stateDirFrom } from './config.mjs';`), 'store.mjs does not import stateDirFrom');
  assert.equal(/STATE_DIR = '/.test(text), false, 'store.mjs pins a state folder constant');
});
