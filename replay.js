/**
 * Market Cipher replay / live paper trader.
 *
 *   node replay.js                         replay most-recent history
 *   node replay.js --from 2025-11-02       replay forward from a date
 *   node replay.js --random                replay from a random past date
 *   node replay.js --live                  live paper mode (real Cipher via webhook)
 *   node replay.js --manual                trade by hand (b=buy, x=sell), strategy off
 *   node replay.js --headless              play to the end, print stats (no keys)
 *
 * In the TUI, [m] toggles manual/auto any time. src/cli.js lists every flag
 * and the README's Flags table mirrors it. Set WEBHOOK_SECRET in the
 * environment to require a matching "secret" field in each live alert.
 *
 * Replay uses a WaveTrend/Market Cipher B RECONSTRUCTION (approximation — see
 * src/cipher.js). Live mode uses that too until real Market Cipher TradingView
 * alerts arrive at the webhook (src/webhook.js). Paper only — no real orders.
 */
import { fetchBars, TF_MS } from "./src/feed.js";
import { createEngine } from "./src/engine.js";
import { createWebhook, startupMessage } from "./src/webhook.js";
import { parseArgs, buildRunConfig } from "./src/cli.js";
import { STRATEGIES } from "./src/strategies.js";
import { runReplay, runLive, runHeadless } from "./src/tui.js";
import { closedBars, SETTLE_MS } from "./src/live.js";

// Resolve the end-of-window timestamp so the chosen start date plays FORWARD.
function resolveEndTime({ from, random }, config, bars, now) {
  const tfMs = TF_MS[config.timeframe];
  // BitGet requires an integer-ms endTime — floor everything.
  if (from) {
    const start = Date.parse(from);
    if (Number.isNaN(start)) throw new Error(`Bad --from date "${from}" (use YYYY-MM-DD).`);
    return Math.floor(Math.min(now, start + bars * tfMs));
  }
  if (random) {
    // Latest start that still leaves `bars` candles before now, then randomize the
    // start across ~18 months BEFORE that. Anchoring the span to maxStart (not an
    // absolute floor) keeps it from collapsing to zero on long timeframes, where
    // bars*tfMs alone already exceeds the history window (e.g. 800 daily = 800 days).
    const maxStart = now - bars * tfMs;
    const start = maxStart - Math.random() * 540 * 86_400_000;
    return Math.floor(Math.min(now, start + bars * tfMs)); // never past now
  }
  return null; // most recent
}

function applyInitialStrategy(engine, name) {
  if (!name) return;
  if (!STRATEGIES.some((s) => s.name === name)) {
    // Throw (not process.exit) so the top-level catch handles it uniformly and
    // any open resource — e.g. the live webhook — gets cleaned up first.
    throw new Error(`Unknown strategy "${name}". Available: ${STRATEGIES.map((s) => s.name).join(", ")}`);
  }
  for (let n = 0; n < STRATEGIES.length && engine.strategy().name !== name; n++) {
    engine.swapStrategy(1);
  }
}

async function loadEngine(config, endTime, bars, mode) {
  process.stdout.write(`Fetching ${bars} ${config.symbol} ${config.timeframe} candles from BitGet...\n`);
  let candles = await fetchBars(config, { endTime, bars });
  // Live mode acts on settled closed bars only, so drop the bar still forming.
  if (mode === "live") candles = closedBars(candles, config.timeframe, Date.now(), SETTLE_MS);
  if (candles.length < 60) {
    throw new Error(`Only ${candles.length} candles returned — not enough for warm-up. Try a more recent date or a lower timeframe.`);
  }
  return createEngine({ candles, config, mode });
}

// Random windows can occasionally land past the exchange's history limit for a
// symbol; retry a few fresh dates before giving up.
async function loadRandomEngine(config, bars, now) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const endTime = resolveEndTime({ random: true }, config, bars, now);
    const candles = await fetchBars(config, { endTime, bars });
    if (candles.length >= 60) {
      process.stdout.write(
        `Random window: ${new Date(candles[0].time).toISOString().slice(0, 10)} → ${new Date(candles.at(-1).time).toISOString().slice(0, 10)}\n`,
      );
      return createEngine({ candles, config, mode: "replay" });
    }
  }
  throw new Error("Couldn't find a random window with enough history — try --from with a recent date.");
}

async function main() {
  const run = buildRunConfig(parseArgs(process.argv.slice(2)), process.env);
  for (const note of run.notes) console.log(note);
  const config = { symbol: run.symbol, timeframe: run.timeframe, bitget: run.bitget };
  const { bars } = run;

  // ── live paper mode ──
  if (run.mode === "live") {
    const webhook = createWebhook({ port: run.port, host: run.host, secret: run.secret });
    const bound = await webhook.listen();
    try {
      const engine = await loadEngine(config, null, bars, "live");
      applyInitialStrategy(engine, run.strategy);
      if (run.manual) engine.setManual(true);
      const notice = startupMessage(bound, { secured: Boolean(run.secret), notes: run.notes });
      console.log(notice);
      await runLive(engine, config, webhook, { pollMs: run.poll, notice });
    } finally {
      await webhook.close(); // always close, even on error — an open server would hang the process
    }
    return;
  }

  // ── replay mode ──
  const interactive = process.stdin.isTTY && !run.headless;

  // 'r' in the TUI resolves { reload: true } → pick a fresh random window.
  let useRandom = run.random;
  for (;;) {
    const now = Date.now(); // fresh each reload so windows track wall-clock time
    const engine = useRandom
      ? await loadRandomEngine(config, bars, now)
      : await loadEngine(config, resolveEndTime({ from: run.from }, config, bars, now), bars, "replay");
    applyInitialStrategy(engine, run.strategy);
    if (run.manual && interactive) engine.setManual(true);

    if (!interactive) {
      runHeadless(engine, config, { label: useRandom ? "(random)" : "" });
      return;
    }
    const result = await runReplay(engine, config, { speed: run.speed, notice: run.notes.join("\n") });
    if (!result?.reload) break;
    useRandom = true;
  }
}

main().catch((err) => {
  process.stdout.write("\x1b[?25h"); // restore cursor
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1; // let the loop drain instead of a hard exit (avoids libuv teardown race)
});
