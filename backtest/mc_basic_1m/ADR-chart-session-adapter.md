# ADR 0003: one run adapter between the mc_basic_1m commands and the chart

Source: MrToAster13/tradingview-mcp branch backtest/mc-chart-session at commit afe8081b86474306e6299d28e734b21c0fd88885 (docs/adr/0003-mc-chart-session-adapter.md)

## Status

Accepted on 2026-10-21 for branch backtest/mc-chart-session. Not yet run against a live chart.

## Context

The mc_basic_1m commands (draw, snapshot, recorder, resolve, clear and broker-reset) read and draw on a live TradingView Desktop chart over CDP. A test that reached that chart could change Elijah's drawings or place a broker order, so lint.test.mjs already forbids any test file from importing cdp.mjs or cli.mjs.

Before this change each command test built its own fake run function. The fakes did not check template names, tabs or argument values, so a command could pass a bad argument and still pass its test. cdp.mjs held the placeholder "FILL_AT_INTEGRATION" for every template pin, and no file connected the commands to cdp.mjs.

## Decision

Every command reaches the chart only through `deps.run(templateName, args, tab)`, as api_v1 says.

- cdp.mjs owns the real run. Its template pins now hold the SHA-256 of each template, and templates_hash.test.mjs checks them by reading cdp.mjs as text.
- cli.mjs is the only file that imports both cdp.mjs and the command mains. It builds deps, calls the command's main with the flags after the command name, sets process.exitCode and closes the chart session in a finally block. It holds no command logic.
- fake_chart.mjs is the one in-memory adapter for tests. Its run makes the same front-door checks as cdp.mjs (close on tab "all", known template name, plain-object args, draw_trade on tab1 only, discover on a chart path) and fills the template through prepareValues and fillPlaceholders. It evaluates nothing; each test supplies the reply.
- templates.mjs exports fillPlaceholders(name, text, values), which looks up the placeholder list and fills the text. cdp.mjs calls it, so the only computed lookups left in cdp.mjs are the template and the hash, as design_v14 line 137 allows.
- lint.test.mjs imports the template and guard strings from templates.mjs and lints those. templates.mjs builds them with join, so the old scan for backtick strings found nothing. The presence lint failed on that, and the other template lints passed without checking anything.
- The client lint (client1, client2, candidate and c) also accepts their declaration, the open statement, the reset to null and null tests. Design_v14 line 137 does not list these forms, so this widens its wording. An alias, a destructure, an indexed use or a bare trailing use still fails the lint.
- draw_trade writes every value as a @@NAME@@ placeholder. Its text used bare names such as TEXT and P1_TIME, which the fill left in place, so the filled text would throw on the chart. Design_v14 line 127 allows only capital letters and underscores in a placeholder name, so the four point placeholders are ENTRY_TIME, ENTRY_PRICE, END_TIME and END_PRICE. The caller keys stay P1_TIME, P1_PRICE, P2_TIME and P2_PRICE, as api_v1 lists them, and prepareValues maps them.
- fillTemplate refuses values whose keys differ from the placeholder list (design_v14 line 127) and a listed name that the text does not contain (api_v1 says the list is the tokens in the text). The fake keeps the filled text on each call record so tests can check it.
- The snapshot, resolve, clear and recorder tests now use the shared fake, and draw.test.mjs tests the draw command through its main.
- package.json gets a test:mc script that runs every test in the folder. This overrides design_v14 line 200, which says this work does not edit package.json; the task asked for the script.

## Consequences

- A command that passes a bad template name, tab or argument now fails its test, because the fake applies the same checks and fill as cdp.mjs.
- Any edit to a template's text needs a new pin in cdp.mjs. templates_hash.test.mjs fails until the pin matches, and cdp.mjs refuses the template at run time.
- The front-door checks live in two places, cdp.mjs and fake_chart.mjs. A change to one needs the same change in the other.
- cli.mjs and the real cdp.mjs run have not been executed. They need the live chart, so their behaviour is unverified until a supervised run.
- The report keeps its own entry point in report.mjs, because it needs no chart. Forward data is reached through `snapshot --forward`; there is no separate forward command.

## Amendment for ELI-778, the move to wavetrend-replay

wavetrend-replay is public, so the tab 1 layout id and the Windows state folder could not move as constants.

- config.mjs reads MC_TAB1_LAYOUT_ID and MC_STATE_DIR and throws E_CONFIG when one is unset or invalid. It is the only file whose env member lint.test.mjs allows.
- cdp.mjs imports tab1LayoutId from config.mjs, so it now has four imports, and lint.test.mjs checks for four. It reads the id on the first chart call, so nothing is sent without it.
- store.mjs takes its folder from config.mjs on every call unless a test set one with __testSetStateDir.
- The templates hold no chart path. draw_trade runs on tab 1 only, so its write guard checks the GUARD_PATH placeholder that cdp.mjs fills with the tab 1 path. read_history used to compare GUARD_PATH with the tab 1 path to decide whether MarketCipher_SR is required. It now compares EXPECTED_RES with "1", which is the same test because tab 1 is the only tab read at resolution 1. The read_history and draw_trade pins in cdp.mjs changed with that text.
- fake_chart.mjs and the tests use the fake tab 1 path /chart/FAKETAB1/.
