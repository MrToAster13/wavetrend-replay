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
 * In the TUI, [m] toggles manual/auto any time. Flags:
 *   --symbol BTCUSDT  --tf 4H  --speed 4  --bars 800  --strategy cipher-cross  --manual
 *
 * Replay uses a WaveTrend/Market Cipher B RECONSTRUCTION (approximation — see
 * src/cipher.js). Live mode uses that too until real Market Cipher TradingView
 * alerts arrive at the webhook (src/webhook.js). Paper only — no real orders.
 */
import { fetchBars, TF_MS, assertTimeframe } from "./src/feed.js";
import { createEngine } from "./src/engine.js";
import { createWebhook } from "./src/webhook.js";
import { STRATEGIES } from "./src/strategies.js";
import { runReplay, runLive, runHeadless } from "./src/tui.js";

// Value-less booleans — never swallow the next token as their value, so
// `--live 8787` can't silently disable live mode.
const BOOLEAN_FLAGS = new Set(["live", "manual", "headless", "random"]);

function parseArgs(argv) {
  const args = { flags: new Set(), opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const body = a.slice(2);
    // Support --key=value alongside --key value.
    const eq = body.indexOf("=");
    if (eq !== -1) {
      args.opts[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const key = body;
    if (BOOLEAN_FLAGS.has(key)) {
      args.flags.add(key);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.opts[key] = next;
      i++;
    } else {
      args.flags.add(key);
    }
  }
  return args;
}

// Parse a numeric option with a default and floor. Rejects non-numeric input
// loudly — Math.max(floor, NaN) is NaN, which would silently poison the run.
function num(raw, { def, min = 1 }) {
  if (raw == null) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Expected a number for this option but got "${raw}".`);
  return Math.max(min, Math.floor(n));
}

function buildConfig(opts) {
  const timeframe = opts.tf || opts.timeframe || process.env.TIMEFRAME || "4H";
  assertTimeframe(timeframe);
  return {
    symbol: opts.symbol || process.env.SYMBOL || "BTCUSDT",
    timeframe,
    // Candles come straight from BitGet's public API (no auth needed).
    // Override the host with BITGET_BASE_URL if needed.
    bitget: { baseUrl: process.env.BITGET_BASE_URL || "https://api.bitget.com" },
  };
}

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
  const candles = await fetchBars(config, { endTime, bars });
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
  const args = parseArgs(process.argv.slice(2));
  const config = buildConfig(args.opts);
  const bars = num(args.opts.bars, { def: 800, min: 120 });
  const speed = num(args.opts.speed, { def: 3, min: 1 });

  // ── live paper mode ──
  if (args.flags.has("live")) {
    const port = num(args.opts.port, { def: 8787, min: 1 });
    const webhook = createWebhook({ port });
    await webhook.listen();
    try {
      const engine = await loadEngine(config, null, 300, "live");
      applyInitialStrategy(engine, args.opts.strategy);
      if (args.flags.has("manual")) engine.setManual(true);
      console.log(`Webhook listening on http://localhost:${port}/alert — point a TradingView Market Cipher alert here.`);
      await runLive(engine, config, webhook, { pollMs: num(args.opts.poll, { def: 5000, min: 250 }) });
    } finally {
      await webhook.close(); // always close, even on error — an open server would hang the process
    }
    return;
  }

  // ── replay mode ──
  const interactive = process.stdin.isTTY && !args.flags.has("headless");

  // 'r' in the TUI resolves { reload: true } → pick a fresh random window.
  let useRandom = args.flags.has("random");
  for (;;) {
    const now = Date.now(); // fresh each reload so windows track wall-clock time
    const engine = useRandom
      ? await loadRandomEngine(config, bars, now)
      : await loadEngine(config, resolveEndTime({ from: args.opts.from }, config, bars, now), bars, "replay");
    applyInitialStrategy(engine, args.opts.strategy);
    if (args.flags.has("manual") && interactive) engine.setManual(true);

    if (!interactive) {
      runHeadless(engine, config, { label: useRandom ? "(random)" : "" });
      return;
    }
    const result = await runReplay(engine, config, { speed });
    if (!result?.reload) break;
    useRandom = true;
  }
}

main().catch((err) => {
  process.stdout.write("\x1b[?25h"); // restore cursor
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1; // let the loop drain instead of a hard exit (avoids libuv teardown race)
});
