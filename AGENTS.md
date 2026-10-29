# AGENTS.md

Repo mechanics for agents working in wavetrend-replay. README.md covers what
the replay tool does and its flags.

## Setup

Node 18 or newer. The repo has no dependencies, so there is nothing to install
and no lockfile.

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
`test/*.test.js`. The tests use synthetic candles and make no network calls.

CI runs `node --test` on Node 18, 20 and 22 on every push to main and every
pull request (`.github/workflows/tests.yml`).

## Layout

- `replay.js` is the CLI entry point.
- `src/` holds the modules: `engine.js` steps through bars, `cipher.js` and
  `series.js` hold the indicator math, `portfolio.js` the paper positions,
  `http.js` the candle fetch, `feed.js` the candle source, `webhook.js` the
  live alert listener, `tui.js` and `chart.js` the terminal UI, and
  `strategies.js` the entry and exit rules.
- `test/` holds the `node --test` files.

## Rules

- Paper trading only. Do not add code that places a real order or takes an
  exchange API key.
- Do not add a dependency without a ticket that asks for one. The README
  promises zero dependencies.
- The repo is public. Never commit an `.env` file, a webhook secret, a home
  path or a TradingView chart layout id.
- A change merges once `node --test` passes on the latest commit and the
  `tests` workflow is green.
- Tickets live in the Obsidian vault under `Tickets/`, project TradingView
  Backtesting AI. Every ticket write goes through `Tickets/_tools/ticket.py`.
