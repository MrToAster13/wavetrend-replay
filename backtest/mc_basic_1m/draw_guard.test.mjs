/*
 * ELI-778 review finding: the write guard used to hold the tab 1 path as a literal, so draw_trade
 * text could only pass on tab 1. It now checks GUARD_PATH, so prepareValues must refuse any
 * context that is not the 1-minute tab 1 context.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareValues } from './templates.mjs';

const ARGS = Object.freeze({
  RUN_ID: 'HTF-a',
  UNVERIFIED: true,
  DEADLINE: 1000,
  IS_LONG: true,
  P1_TIME: 60,
  P1_PRICE: 5000.25,
  P2_TIME: 120,
  P2_PRICE: 5001,
  TEXT_TIME: 60,
  TEXT_PRICE: 5002,
  STOP_LEVEL: 8,
  PROFIT_LEVEL: 16,
});

test('draw_trade fills with the 1-minute tab 1 context', () => {
  const values = prepareValues('draw_trade', { ...ARGS }, { guardPath: '/chart/FAKETAB1/', expectedRes: '1' });
  assert.equal(values.GUARD_PATH, '/chart/FAKETAB1/');
});

test('draw_trade refuses a 15-minute context, which is tab 2 or a discovery page', () => {
  assert.throws(() => prepareValues('draw_trade', { ...ARGS }, { guardPath: '/chart/FAKETAB2/', expectedRes: '15' }), { code: 'E_ARGS' });
});

test('draw_trade refuses a context with no resolution or no guard path', () => {
  assert.throws(() => prepareValues('draw_trade', { ...ARGS }, { guardPath: '/chart/FAKETAB1/' }), { code: 'E_ARGS' });
  assert.throws(() => prepareValues('draw_trade', { ...ARGS }, { expectedRes: '1' }), { code: 'E_ARGS' });
  assert.throws(() => prepareValues('draw_trade', { ...ARGS }, undefined), { code: 'E_ARGS' });
});
