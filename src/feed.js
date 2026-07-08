/**
 * Feed — historical candle windows for replay, and recent candles for live.
 *
 * Uses BitGet's public candles endpoint (no auth, no key needed).
 * Pages backward with `endTime` so a replay can start from an arbitrary past
 * date with enough warm-up history behind it.
 */
import { fetchJson } from "./http.js";

// The timeframes the tool supports — one table carrying both the interval in ms
// (for window math) and BitGet's granularity code (for the API call), so the two
// can't drift. Kept local so this module depends only on http.js.
export const TIMEFRAMES = {
  "1m":  { ms: 60_000,      granularity: "1min" },
  "3m":  { ms: 180_000,     granularity: "3min" },
  "5m":  { ms: 300_000,     granularity: "5min" },
  "15m": { ms: 900_000,     granularity: "15min" },
  "30m": { ms: 1_800_000,   granularity: "30min" },
  "1H":  { ms: 3_600_000,   granularity: "1h" },
  "4H":  { ms: 14_400_000,  granularity: "4h" },
  "1D":  { ms: 86_400_000,  granularity: "1Dutc" },
  "1W":  { ms: 604_800_000, granularity: "1Wutc" },
};

// Interval in ms per timeframe — a derived view of TIMEFRAMES, used by replay's
// window math. TIMEFRAMES is the single source of truth for the valid key set.
export const TF_MS = Object.fromEntries(
  Object.entries(TIMEFRAMES).map(([tf, v]) => [tf, v.ms]),
);

// Reject a timeframe the tool doesn't support. Shared by the CLI config guard and
// the feed, so the two can't disagree about what's valid.
export function assertTimeframe(timeframe) {
  if (!Object.hasOwn(TIMEFRAMES, timeframe)) {
    throw new Error(
      `Unknown timeframe "${timeframe}". Valid: ${Object.keys(TIMEFRAMES).join(", ")}.`,
    );
  }
}

function bitgetGranularity(timeframe) {
  assertTimeframe(timeframe);
  return TIMEFRAMES[timeframe].granularity;
}

// A BitGet candle row is [openTime, open, high, low, close, baseVolume, ...],
// with openTime a string ms and prices as strings — Number()/parseFloat() normalize.
function toCandle(row) {
  const candle = {
    time: Number(row[0]),
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
  };
  // Fail loudly on a malformed row rather than let NaN poison the replay: a NaN
  // time breaks paging and sorting, a NaN price silently corrupts the indicators.
  if (!Number.isFinite(candle.time) || !Number.isFinite(candle.close)) {
    const err = new Error(`BitGet returned a malformed candle row: ${JSON.stringify(row)}`);
    err.recoverable = true;
    throw err;
  }
  return candle;
}

// Public GET against BitGet's v2 API, envelope-checked (code "00000" = success).
async function bitgetPublicGet(baseUrl, path) {
  const json = await fetchJson(`${baseUrl}${path}`, { retries: 2 }); // GET — safe to retry
  if (json?.code !== "00000") {
    const err = new Error(`BitGet API error (code ${json?.code}): ${json?.msg || "unknown"}`);
    err.recoverable = true; // an exchange-side error is an outage, not a bug
    throw err;
  }
  return json.data;
}

// The plain `candles` endpoint only serves ~recent history (≈180 days on 4H)
// but includes the in-progress candle — right for live. `history-candles` reaches
// back years but caps at 200/request and only returns closed candles — right for
// replaying a past date. Pick per endTime.
const RECENT = { path: "candles", cap: 1000 };
const HISTORY = { path: "history-candles", cap: 200 };

/**
 * Fetch up to `bars` candles ending at `endTime` (ms, exclusive), ascending.
 * endTime = null → most recent candles (live).
 */
export async function fetchBars(config, { endTime = null, bars = 800 } = {}) {
  const gran = bitgetGranularity(config.timeframe);
  const symbol = encodeURIComponent(config.symbol);
  const endpoint = endTime == null ? RECENT : HISTORY;
  const collected = [];
  let cursor = endTime;

  while (collected.length < bars) {
    const need = Math.min(endpoint.cap, bars - collected.length);
    let path =
      `/api/v2/spot/market/${endpoint.path}?symbol=${symbol}` +
      `&granularity=${gran}&limit=${need}`;
    if (cursor != null) path += `&endTime=${Math.floor(cursor)}`;

    const rows = await bitgetPublicGet(config.bitget.baseUrl, path);
    if (!Array.isArray(rows) || rows.length === 0) break;

    const chunk = rows.map(toCandle).sort((a, b) => a.time - b.time);
    collected.unshift(...chunk);

    const earliest = chunk[0].time;
    if (cursor != null && earliest >= cursor) break; // no backward progress
    cursor = earliest; // next page ends just before the earliest we have
    if (chunk.length < need) break; // exchange has no more history
  }

  // De-dup by timestamp, keep ascending, trim to the most recent `bars`.
  const seen = new Set();
  return collected
    .filter((c) => (seen.has(c.time) ? false : seen.add(c.time)))
    .sort((a, b) => a.time - b.time)
    .slice(-bars);
}
