/**
 * Replay/live engine — the state machine behind the TUI.
 *
 * Holds the candle history, the precomputed Cipher series, a cursor (which bar
 * is "now"), and a paper portfolio. Processing is high-water-marked: bars are
 * only ever acted on once as the cursor moves forward, so stepping back to look
 * at the chart never double-counts a trade. Swapping the strategy resets the
 * paper account and re-runs it over the bars seen so far — that's what "change
 * strategy on the fly" means here.
 *
 * Live mode starts flat at the first live bar: the loaded history is shown, not
 * traded. Webhook signals a live bar used are kept per bar, so a rebuild after a
 * strategy swap or a return from manual mode replays them too.
 */
import { computeCipher, cipherAt } from "./cipher.js";
import { createPortfolio } from "./portfolio.js";
import { STRATEGIES } from "./strategies.js";

export function createEngine({ candles, config, startEquity = 1000, mode = "replay" }) {
  let series = computeCipher(candles);
  let strategyIndex = 0;
  let manual = false; // manual mode: user places trades by hand, strategy is off
  let portfolio = createPortfolio({ startEquity });
  const actions = []; // recent action log strings

  // Replay starts at the first bar with a valid Cipher reading (post warm-up).
  const startIndex = series.wt2.findIndex((v) => v != null);
  // The first bar the strategy may trade. Live trades only bars that close
  // after the engine starts, so the history it loads is never traded.
  const firstTradable = mode === "live" ? candles.length : startIndex;
  let cursor = mode === "live" || startIndex < 0 ? candles.length - 1 : startIndex;
  let lastProcessed = mode === "live" ? cursor : cursor - 1;
  const overrides = new Map(); // bar index -> the webhook dot that bar used

  const strategy = () => STRATEGIES[strategyIndex];

  function logAction(kind, price, time) {
    actions.push(
      `${kind.padEnd(5)} @ ${price.toFixed(2)}  ${new Date(time).toISOString().slice(0, 16)}`,
    );
    if (actions.length > 6) actions.shift();
  }

  // Act on every unprocessed bar up to i. In live mode, a bar with an entry in
  // `overrides` uses the real Market Cipher signal instead of the reconstruction.
  function processTo(i) {
    if (manual) {
      // Manual mode: bars just advance; entries/exits come from the keyboard.
      if (i > lastProcessed) lastProcessed = i;
      return;
    }
    for (let j = lastProcessed + 1; j <= i; j++) {
      let cipher = cipherAt(series, j);
      if (overrides.has(j)) cipher = { ...cipher, dot: overrides.get(j), ready: true };
      const action = strategy().decide({
        cipher,
        candle: candles[j],
        isLong: portfolio.isLong(),
      });
      const price = candles[j].close;
      if (action === "enter" && portfolio.enterLong(price, candles[j].time)) {
        logAction("ENTER", price, candles[j].time);
      } else if (action === "exit" && portfolio.exitLong(price, candles[j].time)) {
        logAction("EXIT", price, candles[j].time);
      }
    }
    if (i > lastProcessed) lastProcessed = i;
  }

  // Rebuild the paper account from scratch and re-run the strategy over every
  // bar SEEN SO FAR. "Seen so far" is the high-water mark (furthest bar ever
  // processed), NOT the current cursor — stepping back to view the chart must
  // not discard the trades between there and the furthest point reached.
  function reprocessFromStart() {
    const highWater = Math.max(lastProcessed, cursor);
    portfolio = createPortfolio({ startEquity });
    actions.length = 0;
    if (firstTradable < 0) return; // no bar ever cleared warm-up — nothing to run
    lastProcessed = firstTradable - 1;
    processTo(highWater);
  }

  // Switch between auto (strategy) and manual (keyboard). Resets the paper
  // account so the stats only ever reflect the mode that produced them.
  function setManual(on) {
    if (on === manual) return; // idempotent — a repeated set must not wipe state
    manual = on;
    if (manual) {
      lastProcessed = Math.max(lastProcessed, cursor); // freeze; keyboard drives from here
      portfolio = createPortfolio({ startEquity });
      actions.length = 0;
    } else {
      reprocessFromStart(); // back to auto: re-run the strategy over seen bars
    }
  }

  function manualEnter() {
    if (!manual) return false;
    const bar = candles[cursor];
    if (portfolio.enterLong(bar.close, bar.time)) {
      logAction("BUY", bar.close, bar.time);
      return true;
    }
    return false;
  }

  function manualExit() {
    if (!manual) return false;
    const bar = candles[cursor];
    if (portfolio.exitLong(bar.close, bar.time)) {
      logAction("SELL", bar.close, bar.time);
      return true;
    }
    return false;
  }

  return {
    // ── replay controls ──
    stepForward() {
      if (cursor < candles.length - 1) {
        cursor++;
        processTo(cursor);
      }
    },
    stepBack() {
      // view-only: cursor moves back, but processed trades stand (high-water mark)
      if (cursor > startIndex) cursor--;
    },
    atEnd: () => cursor >= candles.length - 1,

    swapStrategy(delta = 1) {
      if (manual) return; // no strategy to swap while trading by hand
      strategyIndex = (strategyIndex + delta + STRATEGIES.length) % STRATEGIES.length;
      reprocessFromStart();
    },

    // ── manual trading ──
    isManual: () => manual,
    setManual,
    toggleManual: () => setManual(!manual),
    manualEnter,
    manualExit,

    // ── live: extend history with freshly closed candles ──
    // A webhook signal applies to the new bar at overrideTime, or to the first
    // new bar when overrideTime names none of them.
    appendCandles(fresh, overrideDot = null, overrideTime = null) {
      const lastTime = candles.length ? candles[candles.length - 1].time : 0;
      const added = fresh.filter((c) => c.time > lastTime);
      if (added.length === 0) return 0;
      const firstNew = candles.length;
      candles.push(...added);
      series = computeCipher(candles);
      cursor = candles.length - 1;
      const at = added.findIndex((c) => c.time === overrideTime);
      if (overrideDot && !manual) overrides.set(firstNew + Math.max(0, at), overrideDot);
      processTo(cursor);
      return added.length;
    },

    // ── accessors for rendering ──
    candles: () => candles,
    series: () => series,
    cursor: () => cursor,
    startIndex,
    mode,
    strategy,
    strategyIndex: () => strategyIndex,
    portfolio: () => portfolio,
    actions: () => actions,
    snapshotAtCursor: () => cipherAt(series, cursor),
  };
}
