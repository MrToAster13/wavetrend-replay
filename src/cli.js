// The command line. One table names every option, whether it takes a value,
// and the modes that use it. Anything outside the table stops the run, because
// a typo that falls back to a default replays a different test than the one
// asked for.
import { assertTimeframe } from "./feed.js";
import { webhookOptions } from "./webhook.js";

const BOTH = ["replay", "live"];

export const OPTIONS = [
  { name: "symbol", takes: "value", modes: BOTH, help: "pair to load, default BTCUSDT or SYMBOL" },
  { name: "tf", takes: "value", modes: BOTH, help: "timeframe, default 4H or TIMEFRAME" },
  { name: "timeframe", takes: "value", modes: BOTH, help: "same as --tf" },
  { name: "strategy", takes: "value", modes: BOTH, help: "starting strategy, default the first one" },
  { name: "bars", takes: "value", modes: BOTH, help: "candles to load, default 800 in replay and 300 live, minimum 120" },
  { name: "manual", takes: "flag", modes: BOTH, help: "start in manual mode, strategy off" },
  { name: "from", takes: "value", modes: ["replay"], help: "replay forward from a date, YYYY-MM-DD" },
  { name: "random", takes: "flag", modes: ["replay"], help: "replay from a random past window" },
  { name: "speed", takes: "value", modes: ["replay"], help: "bars per second, default 3, minimum 1" },
  { name: "headless", takes: "flag", modes: ["replay"], help: "play to the end and print stats" },
  { name: "live", takes: "flag", modes: ["live"], help: "live paper mode with the alert webhook" },
  { name: "port", takes: "value", modes: ["live"], help: "webhook port, default 8787" },
  { name: "host", takes: "value", modes: ["live"], help: "webhook bind address, default 127.0.0.1 or WEBHOOK_HOST" },
  { name: "poll", takes: "value", modes: ["live"], help: "milliseconds between candle polls, default 5000, minimum 250" },
];

const BY_NAME = new Map(OPTIONS.map((o) => [o.name, o]));
const VALID = `Valid options: ${OPTIONS.map((o) => `--${o.name}`).join(", ")}.`;

/** argv tokens to { flags: Set, opts: { name: string } }. Throws on any token outside OPTIONS. */
export function parseArgs(argv) {
  const args = { flags: new Set(), opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}". Options start with --, for example --symbol ${token}. ${VALID}`);
    }
    const eq = token.indexOf("=");
    const name = token.slice(2, eq === -1 ? undefined : eq);
    const option = BY_NAME.get(name);
    if (!option) throw new Error(`Unknown option "--${name}". ${VALID}`);
    if (args.flags.has(name) || Object.hasOwn(args.opts, name)) throw new Error(`--${name} was given twice. Give it once.`);
    if (option.takes === "flag") {
      if (eq !== -1) throw new Error(`--${name} is a flag and takes no value, got "${token}".`);
      args.flags.add(name);
      continue;
    }
    let value;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[++i];
    }
    if (!value) throw new Error(`--${name} needs a value.`);
    args.opts[name] = value;
  }
  return args;
}

// A number option with a default and a floor. A non-number throws, and a value
// that had to change adds a note naming what was asked for and what is used.
function num(name, raw, { def, min }, notes) {
  if (raw == null) return def;
  const asked = Number(raw);
  if (!Number.isFinite(asked)) throw new Error(`--${name} needs a number, got "${raw}".`);
  const used = Math.max(min, Math.floor(asked));
  if (asked < min) notes.push(`--${name} ${raw} is below the minimum, using ${used}.`);
  else if (used !== asked) notes.push(`--${name} ${raw} rounded down to ${used}.`);
  return used;
}

/** Parsed args and the environment to the settings one run uses. Throws on a mode conflict. */
export function buildRunConfig({ flags, opts }, env = {}) {
  const mode = flags.has("live") ? "live" : "replay";
  const given = [...flags, ...Object.keys(opts)];
  for (const name of given) {
    if (BY_NAME.get(name).modes.includes(mode)) continue;
    throw new Error(mode === "live"
      ? `--${name} does not work with --live. Live mode plays the newest bars as they close.`
      : `--${name} only works with --live.`);
  }
  const conflicts = [
    ["from", "random", "--random picks its own start date"],
    ["tf", "timeframe", "they set the same thing"],
    ["manual", "headless", "a headless run has no keys to trade with"],
    ["speed", "headless", "a headless run plays every bar at once"],
  ];
  for (const [a, b, why] of conflicts) {
    if (given.includes(a) && given.includes(b)) throw new Error(`--${a} and --${b} conflict, ${why}. Drop one.`);
  }

  const timeframe = opts.tf || opts.timeframe || env.TIMEFRAME || "4H";
  assertTimeframe(timeframe);
  const notes = [];
  const live = mode === "live";
  return {
    mode,
    symbol: opts.symbol || env.SYMBOL || "BTCUSDT",
    timeframe,
    // Candles come straight from BitGet's public API, no auth needed.
    bitget: { baseUrl: env.BITGET_BASE_URL || "https://api.bitget.com" },
    bars: num("bars", opts.bars, { def: live ? 300 : 800, min: 120 }, notes),
    speed: num("speed", opts.speed, { def: 3, min: 1 }, notes),
    port: num("port", opts.port, { def: 8787, min: 1 }, notes),
    poll: num("poll", opts.poll, { def: 5000, min: 250 }, notes),
    ...webhookOptions(opts, env),
    from: opts.from,
    random: flags.has("random"),
    headless: flags.has("headless"),
    manual: flags.has("manual"),
    strategy: opts.strategy,
    notes,
  };
}
