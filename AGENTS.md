# AGENTS.md

Repo mechanics for agents working in wavetrend-replay. README.md covers what
the replay tool does and its flags.

## Setup

Node 22 or newer, the lowest version CI tests. The replay tool has no dependencies, so the
root has nothing to install. `node --test` needs no install.

The live-chart backtest commands need one package, the CDP client
`chrome-remote-interface`. `backtest/package.json` pins it to one exact version
and `backtest/package-lock.json` locks it. Install it from the repo root:

```
npm ci --prefix backtest
```

To make the pre-commit hook run the suite before each commit, run this once
per clone:

```
git config core.hooksPath .githooks
```

## Full test command

```
node --test
```

`npm test` runs the same thing. Run it from the repo root. It picks up
`test/*.test.js` and `backtest/**/*.test.mjs`. The tests use synthetic candles
and make no network calls.

CI runs `node --test` on Node 22 and 24 on every push to main and every pull
request (`.github/workflows/tests.yml`). Branch protection on main requires
the `node --test (node 22)` and `node --test (node 24)` checks by name, so a
matrix change must update the required checks in the same PR.

## Layout

- `replay.js` is the CLI entry point.
- `src/` holds the modules: `engine.js` steps through bars, `cipher.js` and
  `series.js` hold the indicator math, `portfolio.js` the paper positions,
  `http.js` the candle fetch, `feed.js` the candle source, `webhook.js` the
  live alert listener, `live.js` the live poll step, `tui.js` and `chart.js` the terminal UI, and
  `strategies.js` the entry and exit rules.
- `test/` holds the `node --test` files.

## Rules

- Paper trading only. Do not add code that places a real order or takes an
  exchange API key.
- Do not add a dependency without a ticket that asks for one. The README
  promises zero dependencies. The one exception is the CDP client in
  `backtest/package.json` (ELI-1172). Its version stays exact, with no range.
  To move it, change the pin, run `npm install --prefix backtest` to rewrite
  `backtest/package-lock.json`, and commit both files.
- The repo is public. Never commit an `.env` file, a webhook secret, a home
  path or a TradingView chart layout id.
- A change merges once `node --test` passes on the latest commit and the
  `tests` workflow is green.
- Tickets live in the Obsidian vault under `Tickets/`, project TradingView
  Backtesting AI. Every ticket write goes through `Tickets/_tools/ticket.py`.
