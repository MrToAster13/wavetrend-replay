/**
 * Terminal chart — zero-dependency ANSI. Draws candlesticks with block/│ glyphs
 * and a WaveTrend sparkline underneath. Returns an array of lines (with color
 * escapes) for the TUI to print.
 */
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";
const SPARK = "▁▂▃▄▅▆▇█";

function color(ch, up) {
  return `${up ? GREEN : RED}${ch}${RESET}`;
}

// Candlestick body/wick grid. `candles` is the visible window (already sliced).
export function drawCandles(candles, width, height) {
  const view = candles.slice(-width);
  if (view.length === 0) return { rows: Array(height).fill(""), hi: 0, lo: 0 };

  const hi = Math.max(...view.map((c) => c.high));
  const lo = Math.min(...view.map((c) => c.low));
  const span = hi - lo || 1;

  const rows = [];
  for (let r = 0; r < height; r++) {
    const rowHi = hi - (r / height) * span;
    const rowLo = hi - ((r + 1) / height) * span;
    let line = "";
    for (const c of view) {
      const up = c.close >= c.open;
      const bodyTop = Math.max(c.open, c.close);
      const bodyBot = Math.min(c.open, c.close);
      if (bodyTop >= rowLo && bodyBot <= rowHi) line += color("█", up);
      else if (c.high >= rowLo && c.low <= rowHi) line += color("│", up);
      else line += " ";
    }
    rows.push(line);
  }
  return { rows, hi, lo };
}

// One-row sparkline of a numeric series (nulls render as gaps). `floor`/`ceil`
// pin the scale so WaveTrend's ±60 zones stay visually stable.
export function sparkline(values, width, floor = -70, ceil = 70) {
  const view = values.slice(-width);
  const nums = view.filter((v) => v != null);
  const lo = Math.min(floor, ...nums);
  const hi = Math.max(ceil, ...nums);
  const range = hi - lo || 1;
  return view
    .map((v) => {
      if (v == null) return " ";
      const idx = Math.max(0, Math.min(7, Math.round(((v - lo) / range) * 7)));
      return SPARK[idx];
    })
    .join("");
}

// A row of dot markers aligned under the candles: ● green / ● red where a Cipher
// cross fired, space otherwise.
export function dotRow(dots, width) {
  const view = dots.slice(-width);
  return view
    .map((d) => (d === "green" ? `${GREEN}●${RESET}` : d === "red" ? `${RED}●${RESET}` : `${DIM}·${RESET}`))
    .join("");
}
