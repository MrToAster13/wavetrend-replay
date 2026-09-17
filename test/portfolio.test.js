import { test } from "node:test";
import assert from "node:assert/strict";
import { createPortfolio } from "../src/portfolio.js";

test("a winning long updates equity net of both fees", () => {
  const p = createPortfolio({ startEquity: 1000, feeRate: 0.001 });
  p.enterLong(100, 1);
  p.exitLong(110, 2); // +10% gross − 0.2% fees ≈ +9.8%
  const s = p.stats();
  assert.equal(s.trades, 1);
  assert.equal(s.wins, 1);
  assert.ok(Math.abs(s.returnPct - 9.8) < 1e-6, `got ${s.returnPct}`);
});

test("no double entry, and no exit while flat", () => {
  const p = createPortfolio({ startEquity: 1000 });
  assert.equal(p.exitLong(100, 1), false); // flat → nothing to exit
  assert.equal(p.enterLong(100, 1), true);
  assert.equal(p.enterLong(105, 2), false); // already long
  assert.equal(p.isLong(), true);
});

test("tracks max drawdown across trades", () => {
  const p = createPortfolio({ startEquity: 1000, feeRate: 0 });
  p.enterLong(100, 1);
  p.exitLong(90, 2); // −10%
  p.enterLong(90, 3);
  p.exitLong(99, 4); // +10%
  const s = p.stats();
  assert.ok(s.maxDrawdownPct >= 10 - 1e-9, `maxDD ${s.maxDrawdownPct}`);
  assert.ok(Math.abs(s.returnPct - -1) < 1e-9, `return ${s.returnPct}`); // 0.9*1.1 = 0.99
});

test("profitFactor is null when there are no closed trades", () => {
  const p = createPortfolio({ startEquity: 1000 });
  const s = p.stats();
  assert.equal(s.trades, 0);
  assert.equal(s.profitFactor, null);
});

test("profitFactor is null when every closed trade is a winner (no gross loss)", () => {
  const p = createPortfolio({ startEquity: 1000, feeRate: 0 });
  p.enterLong(100, 1);
  p.exitLong(110, 2); // +10%
  p.enterLong(100, 3);
  p.exitLong(105, 4); // +5%
  p.enterLong(100, 5);
  p.exitLong(120, 6); // +20%
  const s = p.stats();
  assert.equal(s.trades, 3);
  assert.equal(s.wins, 3);
  assert.equal(s.profitFactor, null);
});

test("profitFactor is gross profit over gross loss for a mixed trade set", () => {
  const p = createPortfolio({ startEquity: 1000, feeRate: 0 });
  p.enterLong(100, 1);
  p.exitLong(110, 2); // +10% win
  p.enterLong(100, 3);
  p.exitLong(90, 4); // −10% loss
  p.enterLong(100, 5);
  p.exitLong(105, 6); // +5% win
  p.enterLong(100, 7);
  p.exitLong(95, 8); // −5% loss
  const s = p.stats();
  // gross profit = 10 + 5 = 15, gross loss = 10 + 5 = 15 (in pnlPct magnitude)
  // hand computed, not recomputed by the same formula as the implementation
  assert.equal(s.profitFactor, 1);
});

test("an open position at stats() time does not count toward profitFactor", () => {
  const p = createPortfolio({ startEquity: 1000, feeRate: 0 });
  p.enterLong(100, 1);
  p.exitLong(110, 2); // +10% win
  p.enterLong(100, 3);
  p.exitLong(90, 4); // −10% loss
  p.enterLong(100, 5); // open, unrealized, not part of the sample
  const s = p.stats();
  assert.equal(s.trades, 2);
  assert.ok(s.open !== null);
  assert.equal(s.profitFactor, 1);
});

test("existing stats fields are unchanged by profitFactor", () => {
  const p = createPortfolio({ startEquity: 1000, feeRate: 0.001 });
  p.enterLong(100, 1);
  p.exitLong(110, 2);
  const s = p.stats();
  assert.equal(s.trades, 1);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 0);
  assert.ok(Math.abs(s.returnPct - 9.8) < 1e-6);
  assert.ok("profitFactor" in s);
});
