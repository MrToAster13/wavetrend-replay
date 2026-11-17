import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../src/engine.js";
import { closedBars, createLivePoller, SETTLE_MS } from "../src/live.js";
import { liveStatusLine } from "../src/tui.js";

// Synthetic 1H candles, a gentle wave so the cipher warms up. No network: the
// poller gets a fake fetch and a fake clock.
const TF = "1H";
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

function candleAt(i, close) {
  const c = close ?? 100 + 5 * Math.sin(i / 7) + i * 0.01;
  return { time: T0 + i * HOUR, open: c, high: c + 1, low: c - 1, close: c, volume: 10 };
}

const history = (n) => Array.from({ length: n }, (_, i) => candleAt(i));

// Bar 200's final close in the signal tests. At 100 the reconstruction shows no
// dot on bar 200, so only a webhook signal can open a position there.
const FINAL_CLOSE = 100;
// A poll time safely past a bar's close plus the settle window.
const AFTER_SETTLE = 20_000;
const closeBar200 = (s) => {
  s.clock.now = T0 + 201 * HOUR + AFTER_SETTLE;
  s.exchange.bars = [candleAt(199), candleAt(200, FINAL_CLOSE), candleAt(201, 90)];
};

// Mirrors src/webhook.js: the newest alert wins, and take() reports how many
// untaken alerts it replaced.
function fakeWebhook() {
  let latest = null;
  let received = 0;
  return {
    port: 8787,
    send(signal, symbol, receivedAt = "t") {
      latest = { signal, symbol, receivedAt, replaced: latest ? latest.replaced + 1 : 0 };
      received++;
    },
    take() {
      const s = latest;
      latest = null;
      return s;
    },
    count: () => received,
  };
}

// A live setup: 200 closed bars loaded, the clock inside bar 200, which is
// still forming. `exchange` is what the fake feed returns: the last 3 bars.
function setup() {
  const config = { symbol: "BTCUSDT", timeframe: TF };
  const engine = createEngine({ candles: history(200), config, mode: "live" });
  const webhook = fakeWebhook();
  const clock = { now: T0 + 200 * HOUR + 10_000 };
  const exchange = { bars: [candleAt(198), candleAt(199), candleAt(200, 150)] };
  const poller = createLivePoller({
    engine,
    config,
    webhook,
    fetchBars: async () => exchange.bars.map((c) => ({ ...c })),
    now: () => clock.now,
  });
  return { engine, webhook, clock, exchange, poller };
}

test("closedBars drops a bar whose close time is later than now", () => {
  const bars = history(5);
  const now = T0 + 4 * HOUR + 1; // bar 4 opened 1 ms ago
  assert.deepEqual(
    closedBars(bars, TF, now).map((c) => c.time),
    bars.slice(0, 4).map((c) => c.time),
  );
});

test("closedBars keeps a bar the instant it closes", () => {
  const bars = history(5);
  assert.equal(closedBars(bars, TF, T0 + 5 * HOUR).length, 5);
});

test("a poll never processes the in-progress bar", async () => {
  const { engine, poller } = setup();
  await poller.poll();
  assert.equal(engine.candles().length, 200);
  assert.equal(engine.candles().at(-1).time, T0 + 199 * HOUR);
});

test("a bar is processed once, after it closes, with its final prices", async () => {
  const { engine, poller, clock, exchange } = setup();
  // Mid-bar polls see a forming bar 200 with a moving close.
  exchange.bars[2] = candleAt(200, 150);
  await poller.poll();
  exchange.bars[2] = candleAt(200, 120);
  await poller.poll();
  assert.equal(engine.candles().length, 200);

  // Bar 200 closes at 110. The next poll stores it with that close.
  clock.now = T0 + 201 * HOUR + AFTER_SETTLE;
  exchange.bars = [candleAt(199), candleAt(200, 110), candleAt(201, 90)];
  await poller.poll();
  assert.equal(engine.candles().length, 201);
  assert.equal(engine.candles().at(-1).close, 110);

  // Later polls do not add bar 200 again or change it.
  exchange.bars[1] = candleAt(200, 999);
  await poller.poll();
  assert.equal(engine.candles().length, 201);
  assert.equal(engine.candles().at(-1).close, 110);
});

test("a pending signal survives polls with no new bar and applies to the next closed bar", async () => {
  const { engine, webhook, poller, clock, exchange } = setup();
  // Control: the same bars with no signal never open a position.
  const control = setup();

  webhook.send("green", "BTCUSDT");
  await poller.poll();
  await poller.poll();
  await poller.poll();
  assert.equal(engine.portfolio().isLong(), false);
  assert.equal(poller.status().pending, "green");
  assert.equal(poller.status().applied, 0);

  closeBar200({ clock, exchange });
  closeBar200(control);
  await poller.poll();
  await control.poller.poll();

  assert.equal(control.engine.portfolio().isLong(), false);
  assert.equal(engine.portfolio().isLong(), true);
  assert.equal(engine.portfolio().position().entryPrice, FINAL_CLOSE);
  assert.equal(engine.portfolio().position().entryTime, T0 + 200 * HOUR);
  assert.equal(poller.status().pending, null);
  assert.equal(poller.status().applied, 1);
  assert.equal(poller.status().received, 1);
});

test("the symbol check ignores case", async () => {
  const { engine, webhook, poller, clock, exchange } = setup();
  webhook.send("green", "btcusdt");
  await poller.poll();
  assert.equal(poller.status().pending, "green");
  closeBar200({ clock, exchange });
  await poller.poll();
  assert.equal(engine.portfolio().isLong(), true);
});

test("a signal for another symbol is not applied and is reported by name", async () => {
  const { engine, webhook, poller, clock, exchange } = setup();
  webhook.send("green", "ETHUSDT");
  await poller.poll();
  assert.equal(poller.status().pending, null);
  assert.equal(poller.status().dropped, "ETHUSDT");
  closeBar200({ clock, exchange });
  await poller.poll();
  assert.equal(engine.portfolio().isLong(), false);
  assert.equal(poller.status().applied, 0);
  assert.match(liveStatusLine(poller.status(), 8787), /ETHUSDT/);
});

test("the live status line shows alerts applied apart from alerts received", () => {
  const line = liveStatusLine({ received: 3, applied: 1, pending: "red", dropped: null }, 8787);
  assert.match(line, /received: 3/);
  assert.match(line, /applied: 1/);
  assert.match(line, /pending: red/);
});

test("the live status line says when no alert has arrived", () => {
  const line = liveStatusLine({ received: 0, applied: 0, pending: null, dropped: null }, 8787);
  assert.match(line, /no Cipher alerts yet/);
  assert.match(line, /:8787\/alert/);
});

// ── Regression tests from the adversarial review ──

test("a bar waits out the settle window, so a bar-close alert lands on that bar", async () => {
  const { engine, webhook, poller, clock, exchange } = setup();
  const close200 = T0 + 201 * HOUR;
  exchange.bars = [candleAt(199), candleAt(200, FINAL_CLOSE), candleAt(201, 90)];

  // The poll 1 s after bar 200 closes does not store it yet.
  clock.now = close200 + 1_000;
  await poller.poll();
  assert.equal(engine.candles().length, 200);

  // TradingView's bar-close alert for bar 200 arrives 3 s after the close.
  webhook.send("green", "BTCUSDT");
  clock.now = close200 + AFTER_SETTLE;
  await poller.poll();
  assert.equal(engine.candles().length, 201);
  assert.equal(engine.portfolio().position().entryTime, T0 + 200 * HOUR);
  assert.equal(engine.portfolio().position().entryPrice, FINAL_CLOSE);
});

test("closedBars applies the settle window the poller uses", () => {
  const bars = history(5);
  const close4 = T0 + 5 * HOUR;
  assert.equal(closedBars(bars, TF, close4 + SETTLE_MS - 1, SETTLE_MS).length, 4);
  assert.equal(closedBars(bars, TF, close4 + SETTLE_MS, SETTLE_MS).length, 5);
});

test("when one poll adds two bars, a pending signal applies to the first of them", async () => {
  const { engine, webhook, poller, clock, exchange } = setup();
  webhook.send("green", "BTCUSDT");
  await poller.poll(); // during bar 200: the signal waits

  // The feed fails until bar 201 has also closed, then returns both.
  clock.now = T0 + 202 * HOUR + AFTER_SETTLE;
  exchange.bars = [candleAt(200, FINAL_CLOSE), candleAt(201), candleAt(202)];
  await poller.poll();
  assert.equal(engine.candles().length, 202);
  assert.equal(engine.portfolio().position().entryTime, T0 + 200 * HOUR);
  assert.equal(engine.portfolio().position().entryPrice, FINAL_CLOSE);
});

test("a signal that waits through manual mode expires at the next closed bar", async () => {
  const { engine, webhook, poller, clock, exchange } = setup();
  engine.setManual(true);
  webhook.send("green", "BTCUSDT");
  await poller.poll();
  closeBar200({ clock, exchange });
  await poller.poll();
  assert.equal(poller.status().pending, null);
  assert.equal(poller.status().applied, 0);

  // Back to auto. The next closed bar must not act on the old signal.
  engine.setManual(false);
  clock.now = T0 + 202 * HOUR + AFTER_SETTLE;
  exchange.bars = [candleAt(200, FINAL_CLOSE), candleAt(201), candleAt(202)];
  await poller.poll();
  assert.equal(engine.candles().length, 202);
  assert.equal(engine.portfolio().isLong(), false);
  assert.equal(poller.status().applied, 0);
});

test("the ignored-symbol notice clears when a matching alert arrives", async () => {
  const { webhook, poller } = setup();
  webhook.send("green", "ETHUSDT");
  await poller.poll();
  assert.equal(poller.status().dropped, "ETHUSDT");
  webhook.send("red", "BTCUSDT");
  await poller.poll();
  assert.equal(poller.status().dropped, null);
  assert.doesNotMatch(liveStatusLine(poller.status(), 8787), /ETHUSDT/);
});

test("an ignored symbol is shown without terminal control characters", async () => {
  const { webhook, poller } = setup();
  webhook.send("green", "ETH\x1b[2J\x1b]0;pwned\x07USDT" + "X".repeat(100));
  await poller.poll();
  const shown = poller.status().dropped;
  assert.doesNotMatch(shown, /[\x00-\x1f\x7f]/);
  assert.ok(shown.startsWith("ETH"));
  assert.ok(shown.length <= 32);
});

// ── ELI-1198 ────────────────────────────────────────────────────────────────

// Opens a position at bar 200 that only the webhook can cause.
async function applyGreenAtBar200() {
  const s = setup();
  s.webhook.send("green", "BTCUSDT");
  closeBar200(s);
  await s.poller.poll();
  assert.equal(s.engine.portfolio().position().entryPrice, FINAL_CLOSE);
  return s;
}

test("a webhook override already applied survives a strategy swap", async () => {
  const { engine } = await applyGreenAtBar200();
  engine.swapStrategy(1);
  engine.swapStrategy(-1);
  assert.equal(engine.strategy().name, "cipher-cross");
  assert.equal(engine.portfolio().isLong(), true);
  assert.equal(engine.portfolio().position().entryPrice, FINAL_CLOSE);
});

test("a webhook override already applied survives a return from manual mode", async () => {
  const { engine } = await applyGreenAtBar200();
  engine.setManual(true);
  engine.setManual(false);
  assert.equal(engine.portfolio().isLong(), true);
  assert.equal(engine.portfolio().position().entryPrice, FINAL_CLOSE);
});

test("live mode starts flat: no trade opens before the first live bar", async () => {
  const s = setup();
  const firstLive = T0 + 200 * HOUR;
  closeBar200(s);
  await s.poller.poll();
  s.engine.swapStrategy(1);
  s.engine.swapStrategy(-1);
  const st = s.engine.portfolio().stats();
  for (const t of st.allTrades) assert.ok(t.entryTime >= firstLive, `trade entered at ${t.entryTime}`);
  assert.equal(st.trades, 0);
  assert.deepEqual(s.engine.actions(), []);
});

test("after a pause of 5 bars the next poll backfills every missed closed bar once, in order", async () => {
  const config = { symbol: "BTCUSDT", timeframe: TF };
  const engine = createEngine({ candles: history(200), config, mode: "live" });
  const clock = { now: T0 + 200 * HOUR + 10_000 };
  // The exchange holds bars up to the one forming at clock.now and returns the
  // newest `bars` of them, like BitGet's recent-candles endpoint.
  const fetchBars = async (_config, { bars }) => {
    const forming = Math.floor((clock.now - T0) / HOUR);
    return history(forming + 1).slice(-bars);
  };
  const poller = createLivePoller({ engine, config, webhook: fakeWebhook(), fetchBars, now: () => clock.now });
  await poller.poll();
  assert.equal(engine.candles().length, 200);

  // Asleep through bars 200 to 204. Bar 205 is forming when polling resumes.
  clock.now = T0 + 205 * HOUR + AFTER_SETTLE;
  await poller.poll();
  await poller.poll();
  const times = engine.candles().map((c) => c.time);
  assert.equal(times.length, 205);
  for (let i = 0; i < times.length; i++) assert.equal(times[i], T0 + i * HOUR);
});

test("a second alert before the next closed bar replaces the first and the status says so", async () => {
  const { webhook, poller, clock, exchange, engine } = setup();
  webhook.send("green", "BTCUSDT");
  await poller.poll();
  webhook.send("red", "BTCUSDT");
  await poller.poll();
  assert.equal(poller.status().pending, "red");
  assert.equal(poller.status().replaced, 1);
  assert.match(liveStatusLine(poller.status(), 8787), /replaced: 1/);
  closeBar200({ clock, exchange });
  await poller.poll();
  assert.equal(engine.portfolio().isLong(), false);
});

test("an alert the webhook replaced before a poll took it counts as replaced", async () => {
  const { webhook, poller } = setup();
  webhook.send("green", "BTCUSDT");
  webhook.send("red", "BTCUSDT");
  await poller.poll();
  assert.equal(poller.status().replaced, 1);
  assert.equal(poller.status().pending, "red");
});

// ELI-1198 review finding 1: a backfill adds many bars at once. An alert must
// land on the bar it came for, found from its receivedAt, not the oldest bar.
function pausedSetup() {
  const config = { symbol: "BTCUSDT", timeframe: TF };
  const engine = createEngine({ candles: history(200), config, mode: "live" });
  const clock = { now: T0 + 200 * HOUR + 10_000 };
  const webhook = fakeWebhook();
  const fetchBars = async (_config, { bars }) => history(Math.floor((clock.now - T0) / HOUR) + 1).slice(-bars);
  const poller = createLivePoller({ engine, config, webhook, fetchBars, now: () => clock.now });
  return { engine, clock, webhook, poller };
}

// Bar n closes at T0 + (n + 1) hours.
for (const [label, bar, receivedAt] of [
  ["a bar-close alert for the newest backfilled bar", 204, T0 + 205 * HOUR + 3_000],
  ["an alert that arrived while an early backfilled bar was forming", 201, T0 + 201 * HOUR + 20 * 60_000],
]) {
  test(`${label} applies to that bar`, async () => {
    const { engine, clock, webhook, poller } = pausedSetup();
    await poller.poll();
    webhook.send("green", "BTCUSDT", new Date(receivedAt).toISOString());
    clock.now = T0 + 205 * HOUR + AFTER_SETTLE;
    await poller.poll();
    assert.equal(engine.candles().length, 205);
    const entries = [...engine.portfolio().stats().allTrades.map((t) => t.entryTime), engine.portfolio().position()?.entryTime].filter(Boolean);
    assert.deepEqual(entries, [T0 + bar * HOUR]);
  });
}
