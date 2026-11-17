/**
 * Live poll step — the logic behind `--live`, kept apart from the terminal so a
 * test can drive it with synthetic candles and a fake clock.
 *
 * Live mode acts only on CLOSED bars. BitGet's recent-candles endpoint includes
 * the bar still forming, and a bar stored mid-formation is never updated, so a
 * bar counts only once its close time (open time plus the timeframe) has passed,
 * plus SETTLE_MS. The settle window lets a TradingView "once per bar close"
 * alert for that bar arrive before the bar is processed, and it absorbs a few
 * seconds of clock skew between this machine and the exchange.
 *
 * A webhook signal waits in `pending` until the next closed bar. A poll that
 * adds no bar leaves it there, and a newer alert replaces it. The strategy uses
 * it on that bar. In manual mode no strategy runs, so the signal expires unused.
 */
import { TF_MS } from "./feed.js";

export const SETTLE_MS = 15_000;

export function closedBars(candles, timeframe, now, settleMs = 0) {
  const tfMs = TF_MS[timeframe];
  return candles.filter((c) => c.time + tfMs + settleMs <= now);
}

export function createLivePoller({ engine, config, webhook, fetchBars, now = Date.now }) {
  let pending = null;
  let applied = 0;
  let dropped = null;
  const symbol = String(config.symbol).toUpperCase();

  return {
    async poll() {
      const fresh = await fetchBars(config, { bars: 3 });
      const sig = webhook.take();
      if (sig && sig.symbol && String(sig.symbol).toUpperCase() !== symbol) {
        // The symbol comes from the webhook body and goes to the terminal, so
        // strip control characters (escape sequences) and cap its length.
        dropped = String(sig.symbol).replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 32);
      } else if (sig) {
        pending = sig;
        dropped = null;
      }
      const override = pending && !engine.isManual() ? pending.signal : null;
      const closed = closedBars(fresh, config.timeframe, now(), SETTLE_MS);
      if (engine.appendCandles(closed, override) === 0) return;
      if (override) applied++;
      pending = null;
    },
    status: () => ({
      received: webhook.count(),
      applied,
      pending: pending?.signal ?? null,
      dropped,
    }),
  };
}
