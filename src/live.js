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
 * adds no bar leaves it there. When a second alert arrives first, the last one
 * wins, and `replaced` counts the alerts it pushed out. The strategy uses the
 * signal on the first bar the next poll adds. In manual mode no strategy runs,
 * so the signal expires unused.
 *
 * When one poll adds several bars, the signal goes to the bar it came for: the
 * first added bar whose close plus SETTLE_MS is at or after the alert arrived,
 * else the newest added bar. Without a readable arrival time it goes to the
 * first added bar.
 *
 * Each poll asks for every bar since the last stored one, so a pause (sleep, a
 * lost network) is backfilled in order on the next poll.
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
  let replaced = 0;
  const symbol = String(config.symbol).toUpperCase();
  const tfMs = TF_MS[config.timeframe];

  return {
    async poll() {
      // Bars since the last stored one, plus the one forming. At least 3.
      const last = engine.candles().at(-1).time;
      const bars = Math.max(3, Math.ceil((now() - last) / tfMs) + 1);
      const fresh = await fetchBars(config, { bars });
      const sig = webhook.take();
      if (sig) replaced += sig.replaced ?? 0;
      if (sig && sig.symbol && String(sig.symbol).toUpperCase() !== symbol) {
        // The symbol comes from the webhook body and goes to the terminal, so
        // strip control characters (escape sequences) and cap its length.
        dropped = String(sig.symbol).replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 32);
      } else if (sig) {
        if (pending) replaced++;
        pending = sig;
        dropped = null;
      }
      const override = pending && !engine.isManual() ? pending.signal : null;
      const closed = closedBars(fresh, config.timeframe, now(), SETTLE_MS);
      const added = closed.filter((c) => c.time > last);
      if (added.length === 0) return;
      const arrived = Date.parse(pending?.receivedAt);
      const target = Number.isFinite(arrived)
        ? added.find((c) => c.time + tfMs + SETTLE_MS >= arrived) ?? added.at(-1)
        : added[0];
      engine.appendCandles(closed, override, target.time);
      if (override) applied++;
      pending = null;
    },
    status: () => ({
      received: webhook.count(),
      applied,
      pending: pending?.signal ?? null,
      dropped,
      replaced,
    }),
  };
}
