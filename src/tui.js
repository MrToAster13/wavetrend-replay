/**
 * TUI — render a frame and drive it with the keyboard (zero dependencies).
 *
 * render(engine, config) → a string frame.
 * runReplay(...)  interactive historical replay (play/pause, step, speed, swap).
 * runLive(...)    live paper mode, candles polled + real Cipher signals via webhook.
 * runHeadless(...) no keys — plays to the end and prints final stats (for tests/CI).
 */
import readline from "readline";
import { drawCandles, sparkline, dotRow } from "./chart.js";
import { fetchBars } from "./feed.js";

const CLEAR = "\x1b[2J\x1b[3J\x1b[H";
const C = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const f = (n, d = 2) => (n == null ? "N/A" : Number(n).toFixed(d));

export function render(engine, config) {
  const candles = engine.candles();
  const series = engine.series();
  const i = engine.cursor();
  const cols = process.stdout.columns || 100;
  const rowsN = process.stdout.rows || 30;
  // Reserve 16 cols: 1 leading space + up to a 13-char row suffix ("  cipher dots")
  // + margin, so the widest labelled row never wraps and misaligns the chart.
  const width = Math.max(20, Math.min(cols - 16, 160));
  const height = Math.max(6, Math.min(rowsN - 18, 18));

  const visCandles = candles.slice(0, i + 1);
  const { rows, hi, lo } = drawCandles(visCandles, width, height);
  const bar = candles[i];
  const snap = engine.snapshotAtCursor();
  const st = engine.portfolio().stats();
  const strat = engine.strategy();
  const pos = st.open;

  const out = [];
  const modeTag = engine.mode === "live" ? C.cyan("LIVE") : C.magenta("REPLAY");
  const when = new Date(bar.time).toISOString().slice(0, 16).replace("T", " ");
  out.push(
    ` ${C.bold(config.symbol)} ${config.timeframe}  ${modeTag}   ` +
      `bar ${i - engine.startIndex + 1}/${candles.length - engine.startIndex}   ${when} UTC`,
  );

  // chart with hi/lo axis labels on first/last rows
  rows.forEach((line, r) => {
    let axis = "";
    if (r === 0) axis = C.dim(`  ${hi.toFixed(0)}`);
    else if (r === rows.length - 1) axis = C.dim(`  ${lo.toFixed(0)}`);
    out.push(` ${line}${axis}`);
  });

  out.push(" " + dotRow(series.dot.slice(0, i + 1), width) + C.dim("  cipher dots"));
  out.push(" " + sparkline(series.wt1.slice(0, i + 1), width) + C.dim("  wt1"));
  out.push(" " + sparkline(series.wt2.slice(0, i + 1), width) + C.dim("  wt2"));

  const dotStr =
    snap.dot === "green" ? C.green("● green") : snap.dot === "red" ? C.red("● red") : C.dim("·");
  out.push(
    ` price ${C.bold("$" + f(bar.close))}   wt1 ${f(snap.wt1, 1)}  wt2 ${f(snap.wt2, 1)}  ` +
      `mf ${f(snap.mf, 1)}  rsi ${f(snap.rsi, 0)}  dot ${dotStr}${snap.strong ? C.bold(" STRONG") : ""}`,
  );

  if (engine.isManual()) {
    out.push(` mode: ${C.bold("✋ MANUAL")} ${C.dim("— you place the trades:  [b] buy   [x] sell")}`);
  } else {
    out.push(` strategy: ${C.bold(strat.name)} ${C.dim("— " + strat.description)}`);
  }

  const posStr = pos
    ? C.green(`LONG @ ${f(pos.entryPrice)}  (${f(((bar.close - pos.entryPrice) / pos.entryPrice) * 100)}% open)`)
    : C.dim("flat");
  const retColor = st.returnPct >= 0 ? C.green : C.red;
  out.push(
    ` position: ${posStr}   equity ${retColor(f(st.equity) + ` (${st.returnPct >= 0 ? "+" : ""}${f(st.returnPct)}%)`)}`,
  );
  out.push(
    ` trades ${st.trades}  win ${f(st.winRatePct, 0)}%  ` +
      `maxDD ${f(st.maxDrawdownPct, 1)}%  avgW ${C.green("+" + f(st.avgWinPct))}%  avgL ${C.red(f(st.avgLossPct))}%`,
  );

  const recent = engine.actions().slice(-3);
  if (recent.length) out.push(C.dim(" last: " + recent.join("   ")));

  return out.join("\n");
}

function controlsLine(mode) {
  const keys =
    mode === "live"
      ? "[space] pause   [m] manual/auto  [b] buy  [x] sell   [s] strategy   [q] quit"
      : "[space] play/pause  [→/←] step  [+/-] speed   [m] manual/auto  [b] buy  [x] sell   [s] strategy  [r] random  [q] quit";
  return "\n " + C.dim(keys);
}

function paint(engine, config, extra = "") {
  process.stdout.write(CLEAR + render(engine, config) + extra + controlsLine(engine.mode) + "\n");
}

// ── Interactive historical replay ──────────────────────────────────────────
export function runReplay(engine, config, { speed = 2 } = {}) {
  return new Promise((resolve) => {
    let playing = false;
    let barsPerSec = speed;
    let timer = null;

    const restartClock = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (!playing) return;
        engine.stepForward();
        draw();
        if (engine.atEnd()) {
          playing = false;
          clearInterval(timer); // stop idle wakeups; a keypress re-arms the clock
          timer = null;
          draw(C.dim("\n\n [end of data — press q to quit, s to try another strategy]"));
        }
      }, Math.max(16, 1000 / barsPerSec));
    };

    const draw = (extra = "") =>
      paint(engine, config, `\n ${playing ? C.green("▶ playing") : C.dim("❚❚ paused")}  ${barsPerSec}x` + extra);

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    // teardown does the cleanup WITHOUT settling the promise; cleanup adds the
    // resolve. The 'r' handler needs teardown-then-resolve({reload:true}) — a
    // promise settles once, so calling cleanup (resolve()) first would win and
    // silently drop the reload signal.
    const teardown = () => {
      if (timer) clearInterval(timer);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeAllListeners("keypress");
      process.stdout.write("\x1b[?25h"); // show cursor
    };
    const cleanup = () => {
      teardown();
      resolve();
    };

    process.stdout.write("\x1b[?25l"); // hide cursor
    process.stdin.on("keypress", (str, key) => {
      const name = key?.name;
      if (name === "q" || (key?.ctrl && name === "c")) return cleanup();
      if (str === " " || name === "space") playing = !playing;
      else if (name === "right") engine.stepForward();
      else if (name === "left") engine.stepBack();
      else if (str === "+" || str === "=") barsPerSec = Math.min(60, barsPerSec + 1);
      else if (str === "-" || str === "_") barsPerSec = Math.max(1, barsPerSec - 1);
      else if (name === "s") engine.swapStrategy(key?.shift ? -1 : 1);
      else if (name === "m") engine.toggleManual();
      else if (name === "b") engine.manualEnter();
      else if (name === "x") engine.manualExit();
      else if (name === "r") {
        teardown();
        return resolve({ reload: true });
      }
      restartClock();
      draw();
    });

    restartClock();
    draw();
  });
}

// ── Live paper mode ─────────────────────────────────────────────────────────
export async function runLive(engine, config, webhook, { pollMs = 5000 } = {}) {
  let playing = true;

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const draw = (extra = "") => paint(engine, config, extra);

  // In-flight guard: setInterval ignores the promise an async callback returns,
  // so a fetch slower than pollMs would let polls overlap — double-consuming the
  // webhook signal (take() clears it) and repainting on top of each other.
  let polling = false;
  const poll = async () => {
    if (!playing || polling) return;
    polling = true;
    try {
      const fresh = await fetchBars(config, { bars: 3 });
      const sig = webhook.take();
      const override = sig && (!sig.symbol || sig.symbol === config.symbol) ? sig.signal : null;
      engine.appendCandles(fresh, override);
      draw(
        "\n " +
          (webhook.count() > 0
            ? C.cyan(`live Cipher alerts received: ${webhook.count()}`)
            : C.dim(`no Cipher alerts yet — using reconstruction (webhook on :${webhook.port}/alert)`)),
      );
    } catch (err) {
      draw("\n " + C.red("poll error: " + err.message));
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(poll, pollMs);

  return new Promise((resolve) => {
    process.stdout.write("\x1b[?25l");
    process.stdin.on("keypress", (str, key) => {
      const name = key?.name;
      if (name === "q" || (key?.ctrl && name === "c")) {
        clearInterval(timer);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeAllListeners("keypress");
        process.stdout.write("\x1b[?25h");
        resolve();
      } else if (str === " " || name === "space") {
        playing = !playing;
        draw(playing ? "" : "\n " + C.dim("paused"));
      } else if (name === "s") {
        engine.swapStrategy(key?.shift ? -1 : 1);
        draw();
      } else if (name === "m") {
        engine.toggleManual();
        draw();
      } else if (name === "b") {
        engine.manualEnter();
        draw();
      } else if (name === "x") {
        engine.manualExit();
        draw();
      }
    });
    draw();
    poll();
  });
}

// ── Headless (no TTY) — play to the end, print final stats ──────────────────
export function runHeadless(engine, config, { label = "" } = {}) {
  while (!engine.atEnd()) engine.stepForward();
  const st = engine.portfolio().stats();
  const c = engine.candles();
  const from = new Date(c[engine.startIndex].time).toISOString().slice(0, 10);
  const to = new Date(c[c.length - 1].time).toISOString().slice(0, 10);
  console.log(`\n─ Replay result ${label} ─────────────────────────────`);
  console.log(`  ${config.symbol} ${config.timeframe}   ${from} → ${to}   strategy: ${engine.strategy().name}`);
  console.log(`  bars replayed : ${c.length - engine.startIndex}`);
  console.log(`  trades        : ${st.trades}  (win ${f(st.winRatePct, 0)}%)`);
  console.log(`  return        : ${st.returnPct >= 0 ? "+" : ""}${f(st.returnPct)}%   (equity ${f(st.equity)})`);
  console.log(`  max drawdown  : ${f(st.maxDrawdownPct, 1)}%`);
  console.log(`  avg win/loss  : +${f(st.avgWinPct)}% / ${f(st.avgLossPct)}%`);
  console.log("──────────────────────────────────────────────────────");
  return st;
}
