/**
 * Strategies — the hot-swappable rules the replay/live engine runs.
 *
 * A strategy is pure: decide({ cipher, candle, isLong }) returns "enter",
 * "exit", or null. The engine applies the action to the paper portfolio, so a
 * strategy never touches money or state directly — which is what lets you swap
 * it mid-replay and re-run the account from the same bars.
 *
 * `cipher` is the per-bar snapshot from src/cipher.js:
 *   { wt1, wt2, mf, rsi, dot: "green"|"red"|null, strong, ready }
 * In live mode with a webhook configured, `dot` is the REAL Market Cipher signal
 * instead of the reconstruction; everything else stays the reconstruction.
 *
 * Long-only for now (paper). Add entries here and they show up in the [s] cycle.
 */
export const STRATEGIES = [
  {
    name: "cipher-cross",
    description: "Long on a green dot, exit on a red dot",
    decide({ cipher, isLong }) {
      if (!cipher.ready) return null;
      if (!isLong && cipher.dot === "green") return "enter";
      if (isLong && cipher.dot === "red") return "exit";
      return null;
    },
  },
  {
    name: "cipher-oversold",
    description: "Long only on a STRONG (oversold) green dot; exit on red or RSI>70",
    decide({ cipher, isLong }) {
      if (!cipher.ready) return null;
      if (!isLong && cipher.dot === "green" && cipher.strong) return "enter";
      if (isLong && (cipher.dot === "red" || (cipher.rsi != null && cipher.rsi > 70))) {
        return "exit";
      }
      return null;
    },
  },
  {
    name: "cipher-moneyflow",
    description: "Long on a green dot with positive money flow; exit on red or MF<0",
    decide({ cipher, isLong }) {
      if (!cipher.ready) return null;
      if (!isLong && cipher.dot === "green" && cipher.mf != null && cipher.mf > 0) {
        return "enter";
      }
      if (isLong && (cipher.dot === "red" || (cipher.mf != null && cipher.mf < 0))) {
        return "exit";
      }
      return null;
    },
  },
];

export function strategyByName(name) {
  return STRATEGIES.find((s) => s.name === name) || STRATEGIES[0];
}
