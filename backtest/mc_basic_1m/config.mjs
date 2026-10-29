/*
 * Local settings for mc_basic_1m, read from environment variables so that no chart layout id or
 * home folder sits in the code (ELI-778). The only file in this folder that reads the environment;
 * lint.test.mjs allows the env member here and nowhere else.
 *   MC_TAB1_LAYOUT_ID  the TradingView layout id of tab 1, the MES 1-minute chart, as in
 *                      tradingview.com/chart/<id>/. Letters and digits only.
 *   MC_STATE_DIR       absolute path of the folder that holds the trade log, guard, recorder
 *                      and snapshot files. Created on the first write.
 * Each reader throws E_CONFIG naming the variable when it is unset or invalid.
 */
import { isAbsolute } from 'node:path';

export const ENV_NAMES = Object.freeze({ layout: 'MC_TAB1_LAYOUT_ID', stateDir: 'MC_STATE_DIR' });

const LAYOUT_RE = /^[A-Za-z0-9]+$/;

function configError(message) {
  const e = new Error(message);
  e.code = 'E_CONFIG';
  return e;
}

function read(env, name) {
  const value = env !== null && typeof env === 'object' && Object.hasOwn(env, name) ? env[name] : undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw configError(`${name} is not set; see backtest/README.md`);
  }
  return value;
}

/** The tab 1 layout id from MC_TAB1_LAYOUT_ID. */
export function tab1LayoutId(env = process.env) {
  const id = read(env, ENV_NAMES.layout);
  if (!LAYOUT_RE.test(id)) throw configError(`${ENV_NAMES.layout} must be letters and digits only`);
  return id;
}

/** The state folder from MC_STATE_DIR, which must be an absolute path. */
export function stateDirFrom(env = process.env) {
  const dir = read(env, ENV_NAMES.stateDir);
  if (!isAbsolute(dir)) throw configError(`${ENV_NAMES.stateDir} must be an absolute path`);
  return dir;
}
