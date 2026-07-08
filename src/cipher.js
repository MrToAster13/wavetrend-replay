/**
 * Market Cipher B — reconstruction from candles.
 *
 * ⚠️  This is an APPROXIMATION, not the paid indicator. The real Market Cipher
 *     is closed-source; its exact parameters and proprietary tweaks are not
 *     public. This rebuilds its recognisable core from open formulas:
 *
 *       • WaveTrend oscillator (LazyBear) — the wt1/wt2 lines and the green/red
 *         cross "dots" everyone trades off. This is the heart of Cipher B.
 *       • Money Flow — the green/red momentum area.
 *       • RSI — shown for context.
 *
 *     Use replay to explore behaviour, but calibrate against your own charts;
 *     the dots will be close but won't line up bar-for-bar with the paid tool.
 *     For exact live signals, feed real Market Cipher TradingView alerts through
 *     the webhook (src/webhook.js) instead of this.
 *
 * Signals it emits per bar: { wt1, wt2, mf, rsi, dot: "green"|"red"|null, strong }.
 */
import { hlc3, emaSeries, smaSeries, rsiSeries } from "./series.js";

// WaveTrend defaults (LazyBear / Market Cipher B).
export const CIPHER_DEFAULTS = {
  channelLen: 10, // n1
  averageLen: 21, // n2
  smaLen: 4,
  obLevel1: 53,
  obLevel2: 60,
  osLevel1: -53,
  osLevel2: -60,
  mfPeriod: 60,
  mfMultiplier: 150,
  rsiPeriod: 14,
};

function moneyFlowSeries(candles, period, multiplier) {
  // Market-Cipher-style money flow: candle body as a fraction of its range,
  // scaled and smoothed. Positive = buying pressure, negative = selling.
  const raw = candles.map((c) => {
    const range = c.high - c.low;
    if (!(range > 0)) return 0; // guards 0, negative (malformed high<low), and NaN
    return ((c.close - c.open) / range) * multiplier;
  });
  return smaSeries(raw, period);
}

/**
 * Compute the full per-bar Cipher series for a candle array.
 * Returns arrays aligned to `candles` (with leading nulls during warm-up).
 */
export function computeCipher(candles, opts = {}) {
  const o = { ...CIPHER_DEFAULTS, ...opts };

  const ap = hlc3(candles);
  const esa = emaSeries(ap, o.channelLen);
  const absDev = ap.map((v, i) => (esa[i] == null ? null : Math.abs(v - esa[i])));
  const d = emaSeries(absDev, o.channelLen);

  const ci = ap.map((v, i) => {
    if (esa[i] == null || d[i] == null || d[i] === 0) return null;
    return (v - esa[i]) / (0.015 * d[i]);
  });

  const wt1 = emaSeries(ci, o.averageLen); // tci
  const wt2 = smaSeries(wt1, o.smaLen);
  const mf = moneyFlowSeries(candles, o.mfPeriod, o.mfMultiplier);
  const rsi = rsiSeries(candles.map((c) => c.close), o.rsiPeriod);

  const dot = new Array(candles.length).fill(null);
  const strong = new Array(candles.length).fill(false);
  for (let i = 1; i < candles.length; i++) {
    if (wt1[i] == null || wt2[i] == null || wt1[i - 1] == null || wt2[i - 1] == null) {
      continue;
    }
    const prev = wt1[i - 1] - wt2[i - 1];
    const now = wt1[i] - wt2[i];
    if (prev <= 0 && now > 0) {
      dot[i] = "green"; // wt1 crosses up through wt2 → potential long
      strong[i] = wt2[i] <= o.osLevel1; // in oversold territory
    } else if (prev >= 0 && now < 0) {
      dot[i] = "red"; // wt1 crosses down through wt2 → potential short/exit
      strong[i] = wt2[i] >= o.obLevel1; // in overbought territory
    }
  }

  return { wt1, wt2, mf, rsi, dot, strong, levels: o };
}

// Snapshot of the Cipher state at one bar — what a strategy sees.
export function cipherAt(series, i) {
  return {
    wt1: series.wt1[i],
    wt2: series.wt2[i],
    mf: series.mf[i],
    rsi: series.rsi[i],
    dot: series.dot[i],
    strong: series.strong[i],
    ready: series.wt1[i] != null && series.wt2[i] != null,
  };
}
