# Backtest scripts moved from tradingview-mcp

This folder holds the Market Cipher backtest scripts that used to sit on the public tradingview-mcp branches `backtest/mc-basic-1m` and `backtest/mc-chart-session` (ELI-778). Each copied file starts with a `Source:` line that names its branch and commit.

- `mc_basic_1m/` is the MES 1-minute backtester. It reads the MarketCipher_B and MarketCipher_SR plot values from a live TradingView Desktop chart over CDP, simulates the HTF-a, HTF-b and HTF-c runs, draws trades for review and prints the report. It comes from `backtest/mc-chart-session` at afe8081, which holds every mc_basic_1m change from both branches. `CONTEXT.md` names its terms and `ADR-chart-session-adapter.md` records its chart adapter.
- `mc_b_dot/` is the MC B dot strategy: the two Pine strategies, the chart reader, the replay collector, the exit sweep and the per-instrument grid. It comes from `backtest/mc-basic-1m` at 8930382.

Neither folder computes the Market Cipher indicator. Both read the plot values TradingView already computed. `src/cipher.js` stays the one place in this repo that computes WaveTrend and Money Flow.

## Settings

The scripts read local settings from environment variables. Keep the values in a `.env` file or your shell profile; the repo's `.gitignore` already ignores `.env`.

| Variable | Used by | Value |
| --- | --- | --- |
| `MC_TAB1_LAYOUT_ID` | `mc_basic_1m/cdp.mjs` | The layout id of the MES 1-minute chart, the part after `tradingview.com/chart/`. Letters and digits only. |
| `MC_STATE_DIR` | `mc_basic_1m/store.mjs` | Absolute path of the folder for the trade log, guard, recorder and snapshot files. |
| `TRADINGVIEW_MCP_DIR` | `mc_b_dot/collect.mjs` | Path of a tradingview-mcp checkout. The collector loads its chart and replay helpers from there. |

A missing or invalid setting stops the command with `E_CONFIG` before anything touches the chart or the disk.

## The CDP client

The repo has no dependencies, so the CDP client is not installed with it. The commands that talk to a live chart (`mc_basic_1m/cli.mjs`, `mc_b_dot/read.mjs` and `mc_b_dot/collect.mjs`) need it:

```
npm install --no-save chrome-remote-interface@^0.33.2
```

`npm test` does not need it. No test imports `cdp.mjs` or `cli.mjs`, and `lint.test.mjs` checks that.

## Reports and notes stay off GitHub

Backtest reports, findings pages, handoffs and strategy notes are not committed here. `.gitignore` ignores `backtest/**/*.html`, `backtest/**/reports/` and `backtest/**/state/`, and `private_data.test.mjs` fails if a report, a Windows home path or a real chart layout id lands under this folder.

## Running

```
npm test
MC_TAB1_LAYOUT_ID=... MC_STATE_DIR=... node backtest/mc_basic_1m/cli.mjs <draw|snapshot|recorder|resolve|clear|broker-reset> [flags]
node backtest/mc_basic_1m/report.mjs <snapshot.json>
node backtest/mc_b_dot/grid.mjs <dataDir> <outJson>
```
