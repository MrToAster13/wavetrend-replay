# wavetrend-replay

A terminal tool that replays candle history bar by bar and paper-trades a strategy against it — like TradingView's Bar Replay, but scriptable, with a reconstructed Market Cipher B / WaveTrend oscillator driving the signals. Zero dependencies, Node 18+.

## What it does

- **Replay** past market data one bar at a time and watch a strategy trade a paper portfolio.
- **Reconstruct** Market Cipher B (WaveTrend crosses + money-flow + RSI) from raw candles. The signal math is implemented from the formulas, not pulled from a library.
- **Live paper mode** watches recent candles and can ingest real Market Cipher TradingView alerts over a local webhook.
- **Manual mode** — trade by hand (`b` / `x`) to feel a strategy out.

Paper only. No real orders are ever placed.

## Run it

```bash
node replay.js                    # replay recent history
node replay.js --from 2025-11-02  # replay forward from a date
node replay.js --random           # replay from a random past window
node replay.js --live             # live paper mode (webhook for real alerts)
node replay.js --headless         # play to the end, print stats
npm test                          # node --test
```

More flags: `--symbol BTCUSDT --tf 4H --speed 4 --bars 800 --strategy cipher-cross --manual`. In the TUI, `[m]` toggles manual/auto and `[r]` reloads a fresh random window. Candles come from BitGet's public candle endpoint; no key needed.

The `--symbol` / `--tf` defaults also read from the `SYMBOL`, `TIMEFRAME`, and `BITGET_BASE_URL` environment variables — set them in your shell, or run `node --env-file=.env replay.js` (Node 20.6+) to load them from a file.

## How it's built

- **`src/engine.js`** — a high-water-mark bar processor: step back to review the chart without double-counting trades, warm-up nulls handled, state reset cleanly on a mode switch.
- **`src/cipher.js`** — the WaveTrend / Market Cipher reconstruction, over a small pure-function indicator layer (`src/series.js`).
- **`src/http.js`** — a bounded-timeout fetch wrapper that retries only idempotent GETs and tells a recoverable outage apart from a real bug.
- **`src/portfolio.js`** — paper positions, equity, drawdown. **`src/tui.js`** / **`src/chart.js`** — the terminal chart, the controls, and the live-poll loop (re-entrancy guarded).
- Tests (`node --test`) cover the indicator math, the cipher warm-up and crosses, and the portfolio accounting. No network, synthetic candles.

## Honest origin

I built this replay engine from scratch as an addition to a fork of someone else's Claude + TradingView trading bot. The bot's live-order code is not mine and does not ship here — this repo is only the replay/backtest engine, which I wrote end to end. No third-party trading code is included.

The Market Cipher reconstruction approximates the paid indicator from public WaveTrend formulas, so treat backtest results as directional, not precise. This is a learning and backtesting tool, not trading advice.

## License

MIT © Elijah Zion
