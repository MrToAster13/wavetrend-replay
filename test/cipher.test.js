import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCipher, cipherAt } from "../src/cipher.js";

// A deterministic oscillating price (sine — not Math.random) so WaveTrend swings
// and produces both green and red crosses.
function sineCandles(n) {
  const candles = [];
  for (let i = 0; i < n; i++) {
    const p = 100 + 10 * Math.sin(i / 6);
    candles.push({ time: i * 3_600_000, open: p - 0.5, high: p + 1, low: p - 1, close: p, volume: 10 });
  }
  return candles;
}

test("computeCipher returns arrays aligned to the candles", () => {
  const candles = sineCandles(200);
  const s = computeCipher(candles);
  for (const key of ["wt1", "wt2", "mf", "rsi", "dot", "strong"]) {
    assert.equal(s[key].length, candles.length, `${key} length`);
  }
});

test("warm-up leaves leading nulls, then values become ready", () => {
  const s = computeCipher(sineCandles(200));
  assert.equal(s.wt1[0], null);
  assert.ok(s.wt1.filter((v) => v != null).length > 100);
});

test("an oscillating series produces alternating green/red crosses", () => {
  const s = computeCipher(sineCandles(200));
  const greens = s.dot.filter((d) => d === "green").length;
  const reds = s.dot.filter((d) => d === "red").length;
  assert.ok(greens > 0 && reds > 0, `expected both dot colors, got g=${greens} r=${reds}`);

  const seq = s.dot.filter(Boolean);
  let flips = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) flips++;
  assert.ok(flips >= seq.length - 2, "crosses should alternate direction");
});

test("cipherAt reports ready=false during warm-up, true after", () => {
  const s = computeCipher(sineCandles(200));
  assert.equal(cipherAt(s, 0).ready, false);
  assert.equal(cipherAt(s, 199).ready, true);
});
