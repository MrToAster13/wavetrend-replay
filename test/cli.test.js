import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { OPTIONS, parseArgs, buildRunConfig } from "../src/cli.js";

// ELI-1173: a typo in a replay option must stop the run, not replay something
// else. None of these tests touch the network: every case fails or resolves
// before a candle fetch.

const run = (argv, env = {}) => buildRunConfig(parseArgs(argv), env);
const REPLAY = fileURLToPath(new URL("../replay.js", import.meta.url));

function cli(argv) {
  return spawnSync(process.execPath, [REPLAY, ...argv], { encoding: "utf8", env: { ...process.env, BITGET_BASE_URL: "http://127.0.0.1:9" } });
}

test("an unknown option is rejected by name, with the valid options listed", () => {
  assert.throws(() => parseArgs(["--symbl", "ETHUSDT"]), (err) => {
    assert.match(err.message, /--symbl/);
    for (const o of OPTIONS) assert.ok(err.message.includes(`--${o.name}`), `lists --${o.name}`);
    return true;
  });
});

test("a positional argument is rejected by name", () => {
  assert.throws(() => parseArgs(["ETHUSDT"]), /"ETHUSDT".*--symbol/s);
});

test("a flag given a value is rejected instead of being dropped", () => {
  assert.throws(() => parseArgs(["--live=1"]), /--live/);
});

test("the CLI exits 1 on an unknown option and names it", () => {
  const r = cli(["--symbl", "ETHUSDT", "--headless"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--symbl/);
  assert.doesNotMatch(r.stdout, /Fetching/);
});

test("a value option with no value is rejected by name", () => {
  for (const argv of [["--strategy"], ["--tf", "--headless"], ["--from="], ["--port", "--live"]]) {
    const name = argv[0].replace(/=.*/, "");
    assert.throws(() => parseArgs(argv), new RegExp(`${name}\\b.*value`), argv.join(" "));
  }
});

test("the CLI exits 1 when a value option has no value", () => {
  const r = cli(["--from"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--from/);
});

test("a numeric option raised to its floor prints the value asked for and the value used", () => {
  const replay = run(["--bars", "50"]);
  assert.equal(replay.bars, 120);
  assert.equal(replay.notes.length, 1);
  assert.match(replay.notes[0], /--bars 50\b.*\b120\b/);

  const live = run(["--live", "--poll", "100"]);
  assert.equal(live.poll, 250);
  assert.equal(live.notes.length, 1);
  assert.match(live.notes[0], /--poll 100\b.*\b250\b/);
});

test("a numeric option inside its range prints nothing", () => {
  assert.deepEqual(run(["--bars", "500", "--speed", "4"]).notes, []);
});

test("live mode honors --bars and defaults to 300", () => {
  assert.equal(run(["--live"]).bars, 300);
  assert.equal(run(["--live", "--bars", "500"]).bars, 500);
  assert.equal(run(["--live"]).mode, "live");
});

test("replay-only options with --live are rejected and name the conflict", () => {
  for (const extra of [["--speed", "4"], ["--from", "2025-11-02"], ["--random"], ["--headless"]]) {
    assert.throws(() => run(["--live", ...extra]), new RegExp(`${extra[0]}.*--live`), extra[0]);
  }
});

test("--from with --random is rejected and names both", () => {
  assert.throws(() => run(["--from", "2025-11-02", "--random"]), /--from.*--random|--random.*--from/);
});

test("live-only options without --live are rejected and name the conflict", () => {
  for (const extra of [["--port", "9000"], ["--host", "0.0.0.0"], ["--poll", "1000"]]) {
    assert.throws(() => run(extra), new RegExp(`${extra[0]}.*--live`), extra[0]);
  }
});

test("the CLI exits 1 on --live with --speed", () => {
  const r = cli(["--live", "--speed", "4"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--speed/);
  assert.doesNotMatch(r.stdout, /Webhook listening/);
});

test("valid options build the config the run uses", () => {
  const c = run(["--symbol", "ETHUSDT", "--tf=1H", "--from", "2025-11-02", "--strategy", "cipher-cross", "--manual"], {});
  assert.equal(c.mode, "replay");
  assert.equal(c.symbol, "ETHUSDT");
  assert.equal(c.timeframe, "1H");
  assert.equal(c.from, "2025-11-02");
  assert.equal(c.strategy, "cipher-cross");
  assert.equal(c.manual, true);
  assert.equal(c.bars, 800);
  assert.equal(c.speed, 3);
});

test("the README flag list names every option in the table", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const start = readme.indexOf("## Flags");
  assert.notEqual(start, -1, "README has a Flags section");
  const end = readme.indexOf("\n## ", start + 3);
  const flags = readme.slice(start, end === -1 ? undefined : end);
  for (const o of OPTIONS) {
    assert.match(flags, new RegExp(`\`--${o.name}\\b`), `README lists --${o.name}`);
  }
});

// ELI-1173 review finding 1: notes printed before the TUI were wiped by its
// first paint, so they must ride in every frame, as the webhook notice does.
test("a floor note stays in every replay TUI frame", async () => {
  const { createEngine } = await import("../src/engine.js");
  const { runReplay } = await import("../src/tui.js");
  const candles = Array.from({ length: 150 }, (_, i) => {
    const c = 100 + 5 * Math.sin(i / 7);
    return { time: Date.UTC(2026, 0, 1) + i * 3_600_000, open: c, high: c + 1, low: c - 1, close: c, volume: 10 };
  });
  const config = { symbol: "BTCUSDT", timeframe: "1H" };
  const engine = createEngine({ candles, config, mode: "replay" });
  const note = run(["--bars", "50"]).notes[0];
  const frames = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => (frames.push(String(chunk)), true);
  try {
    const done = runReplay(engine, config, { speed: 1, notice: note });
    process.stdin.emit("keypress", "", { name: "right" });
    process.stdin.emit("keypress", "q", { name: "q" });
    await done;
  } finally {
    process.stdout.write = write;
    process.stdin.pause(); // the keypress listener started a stdin read that would hold the test open
  }
  const painted = frames.filter((f) => f.includes("\x1b[2J"));
  assert.ok(painted.length >= 2, "painted at least two frames");
  for (const f of painted) assert.ok(f.includes(note), "frame keeps the note");
});

test("the live startup notice carries the floor notes", async () => {
  const { startupMessage } = await import("../src/webhook.js");
  const note = run(["--live", "--poll", "100"]).notes[0];
  const msg = startupMessage({ address: "127.0.0.1", port: 8787 }, { secured: true, notes: [note] });
  assert.ok(msg.includes(note));
  assert.match(msg, /127\.0\.0\.1:8787/);
});

// Review finding 2: a repeated option dropped one value with no message.
test("an option given twice is rejected by name", () => {
  assert.throws(() => parseArgs(["--symbol", "ETHUSDT", "--symbol", "SOLUSDT"]), /--symbol.*twice/);
  assert.throws(() => parseArgs(["--headless", "--headless"]), /--headless.*twice/);
});

test("--tf with --timeframe is rejected", () => {
  assert.throws(() => run(["--tf", "1H", "--timeframe", "1D"]), /--tf.*--timeframe/);
});

// Review finding 3: a headless run has no TUI, so manual mode and speed do nothing.
test("--manual or --speed with --headless is rejected and names the conflict", () => {
  assert.throws(() => run(["--headless", "--manual"]), /--manual.*--headless/);
  assert.throws(() => run(["--headless", "--speed", "4"]), /--speed.*--headless/);
});
