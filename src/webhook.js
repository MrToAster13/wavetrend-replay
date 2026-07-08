/**
 * Webhook receiver — ingests REAL Market Cipher signals in live mode.
 *
 * Market Cipher is closed-source; the only way to get its exact signals is to
 * have TradingView push them out. In TradingView: create an alert on the Market
 * Cipher B indicator, set "Webhook URL" to http://YOUR_HOST:PORT/alert, and put
 * a JSON message like:
 *
 *   {"signal":"green","symbol":"BTCUSDT"}      // green dot / buy
 *   {"signal":"red","symbol":"BTCUSDT"}        // red dot / sell
 *
 * TradingView only reaches a PUBLIC URL, so for a laptop you need a tunnel
 * (e.g. `ngrok http 8787`) and use the tunnel URL in the alert. On a VPS with an
 * open port, use the host directly.
 *
 * Uses Node's built-in http — no dependency. Stores only the latest signal; the
 * live loop reads it each bar and clears it after acting.
 */
import { createServer } from "http";

export function createWebhook({ port = 8787 } = {}) {
  let latest = null; // { signal: "green"|"red", symbol, receivedAt }
  let received = 0;

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/alert")) {
      res.writeHead(404).end("not found");
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) req.destroy(); // guard against oversized posts
    });
    req.on("end", () => {
      let signal = null;
      let symbol = null;
      try {
        const parsed = JSON.parse(body);
        signal = String(parsed.signal || "").toLowerCase();
        symbol = parsed.symbol;
      } catch {
        // Also accept a bare word body ("green"/"red") for simple alerts.
        signal = body.trim().toLowerCase();
      }
      if (signal === "green" || signal === "red") {
        latest = { signal, symbol, receivedAt: new Date().toISOString() };
        received++;
        res.writeHead(200).end("ok");
      } else {
        res.writeHead(400).end('expected {"signal":"green"|"red"}');
      }
    });
  });

  return {
    listen() {
      return new Promise((resolve) => server.listen(port, resolve));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
    // Read and clear the latest signal (so each alert acts once).
    take() {
      const s = latest;
      latest = null;
      return s;
    },
    peek: () => latest,
    count: () => received,
    port,
  };
}
