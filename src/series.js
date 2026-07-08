/**
 * Series math — indicators that emit a value PER BAR, not one value for "now".
 *
 * A live signal only needs the current indicator value; replay needs it at
 * every historical bar. Every function here is causal: out[i] depends only on
 * inputs at indices <= i, so revealing bars one at a time never leaks the
 * future (no look-ahead bias).
 *
 * Leading `null`s mean "not enough data yet" and propagate through the chain.
 */

export function hlc3(candles) {
  return candles.map((c) => (c.high + c.low + c.close) / 3);
}

// EMA with an SMA seed, tolerant of leading nulls in the input.
export function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let ema = null;
  let seedCount = 0;
  let seedSum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (ema == null) {
      seedCount++;
      seedSum += v;
      if (seedCount >= period) {
        ema = seedSum / period;
        out[i] = ema;
      }
    } else {
      ema = v * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

// Simple moving average over the last `period` non-null values.
export function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  const window = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      out[i] = null;
      continue;
    }
    window.push(v);
    if (window.length > period) window.shift();
    if (window.length === period) {
      out[i] = window.reduce((a, b) => a + b, 0) / period;
    }
  }
  return out;
}

// Wilder-smoothed RSI as a per-bar series (Wilder's smoothing matches
// TradingView's RSI, unlike a plain simple-average RSI).
export function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
