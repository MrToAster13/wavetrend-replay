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
