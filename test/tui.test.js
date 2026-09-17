import { test } from "node:test";
import assert from "node:assert/strict";
import { formatProfitFactor } from "../src/tui.js";

// tui.js has no rendered-frame coverage (render()/runHeadless() write straight
// to a terminal/console), so this asserts on the formatting helper itself
// rather than a captured frame. See PR body for the seam note.

test("formatProfitFactor renders null as n/a", () => {
  assert.equal(formatProfitFactor(null), "n/a");
});

test("formatProfitFactor renders a value to two decimal places", () => {
  assert.equal(formatProfitFactor(1.5), "1.50");
});

test("formatProfitFactor never prints Infinity or NaN", () => {
  assert.equal(formatProfitFactor(Infinity), "n/a");
  assert.equal(formatProfitFactor(NaN), "n/a");
});
