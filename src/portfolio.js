/**
 * Paper portfolio — long-only, one position at a time, no real orders.
 *
 * Each entry deploys `positionFraction` of current equity (default 100%, so the
 * equity curve compounds and returns are legible). Fees are charged on both
 * sides. This is a simulator for replay/live paper trading, not an accountant.
 *
 * Stats (return, max drawdown, equity) are REALIZED — they move only when a
 * position closes. An open position's unrealized P&L is shown separately on the
 * TUI position line, not folded into these figures.
 */
export function createPortfolio({
  startEquity = 1000,
  feeRate = 0.001,
  positionFraction = 1,
} = {}) {
  let equity = startEquity;
  let peak = equity;
  let maxDD = 0;
  let position = null; // { entryPrice, entryTime }
  const trades = [];

  function markDrawdown() {
    if (equity > peak) peak = equity;
    const dd = peak === 0 ? 0 : (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    isLong: () => position !== null,
    position: () => position,
    equity: () => equity,

    enterLong(price, time) {
      if (position) return false;
      position = { entryPrice: price, entryTime: time };
      return true;
    },

    exitLong(price, time) {
      if (!position) return false;
      const gross = (price - position.entryPrice) / position.entryPrice;
      const net = (gross - 2 * feeRate) * positionFraction;
      equity *= 1 + net;
      trades.push({
        entryTime: position.entryTime,
        entryPrice: position.entryPrice,
        exitTime: time,
        exitPrice: price,
        pnlPct: net * 100,
        win: net > 0,
      });
      markDrawdown();
      position = null;
      return true;
    },

    stats() {
      const wins = trades.filter((t) => t.win).length;
      const closed = trades.length;
      const avg = (arr) =>
        arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      return {
        equity,
        startEquity,
        returnPct: (equity / startEquity - 1) * 100,
        trades: closed,
        wins,
        losses: closed - wins,
        winRatePct: closed ? (wins / closed) * 100 : 0,
        avgWinPct: avg(trades.filter((t) => t.win).map((t) => t.pnlPct)),
        avgLossPct: avg(trades.filter((t) => !t.win).map((t) => t.pnlPct)),
        maxDrawdownPct: maxDD * 100,
        open: position,
        allTrades: trades,
      };
    },
  };
}
