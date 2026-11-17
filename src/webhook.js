/**
 * Webhook receiver — ingests REAL Market Cipher signals in live mode.
 *
 * Market Cipher is closed-source; the only way to get its exact signals is to
 * have TradingView push them out. In TradingView: create an alert on the Market
 * Cipher B indicator, set "Webhook URL" to http://YOUR_HOST:PORT/alert, and put
 * a JSON message like:
 *
 *   {"signal":"green","symbol":"BTCUSDT","secret":"YOUR_WEBHOOK_SECRET"}   // green dot / buy
 *   {"signal":"red","symbol":"BTCUSDT","secret":"YOUR_WEBHOOK_SECRET"}     // red dot / sell
 *
 * Start live mode with the same value in the WEBHOOK_SECRET environment
 * variable. A POST without the matching secret gets 401. TradingView cannot
 * send custom headers, so the secret rides in the message body. Without
 * WEBHOOK_SECRET any caller that reaches the port can post signals, and the
 * CLI says so at startup.
 *
 * The webhook listens on 127.0.0.1 unless --host or WEBHOOK_HOST names another
 * address. TradingView only reaches a PUBLIC URL, so for a laptop you need a
 * tunnel (e.g. `ngrok http 8787`), which forwards to localhost. On a VPS with an
 * open port, pass --host 0.0.0.0 and set a secret.
 *
 * Uses Node's built-in http — no dependency. Stores only the latest signal; the
 * live poll step (src/live.js) takes it each poll. The last alert wins, and the
 * one taken carries `replaced`, the count of untaken alerts it pushed out.
 */
import { createServer } from "http";
import { createHash, timingSafeEqual } from "crypto";

const MAX_BODY = 10_000;

// Constant-time compare. Hashing first gives both sides the same length.
function secretMatches(given, secret) {
  if (typeof given !== "string") return false;
  const digest = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

// Parse a body into a signal, or say why it is refused.
function readSignal(body, secret) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A bare-word body ("green"/"red") has no room for a secret.
    if (secret) return { status: 401 };
    return { signal: body.trim().toLowerCase(), symbol: undefined };
  }
  const obj = parsed !== null && typeof parsed === "object" ? parsed : {};
  if (secret && !secretMatches(obj.secret, secret)) return { status: 401 };
  return { signal: String(obj.signal || "").toLowerCase(), symbol: obj.symbol };
}

export function createWebhook({ port = 8787, host = "127.0.0.1", secret = null } = {}) {
  let latest = null; // { signal: "green"|"red", symbol, receivedAt }
  let received = 0;

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/alert")) {
      res.writeHead(404).end("not found");
      return;
    }
    req.setEncoding("utf8"); // decode across chunks, so a split character survives
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > MAX_BODY) {
        tooLarge = true;
        res.writeHead(413, { Connection: "close" }).end("body too large", () => req.destroy());
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      const result = readSignal(body, secret);
      if (result.status === 401) {
        res.writeHead(401).end("unauthorized");
      } else if (result.signal === "green" || result.signal === "red") {
        const replaced = latest ? latest.replaced + 1 : 0;
        latest = { signal: result.signal, symbol: result.symbol, receivedAt: new Date().toISOString(), replaced };
        received++;
        res.writeHead(200).end("ok");
      } else {
        res.writeHead(400).end('expected {"signal":"green"|"red"}');
      }
    });
  });

  return {
    // Resolves with the address actually bound: { address, port }.
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const { address, port: boundPort } = server.address();
          resolve({ address, port: boundPort });
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
    // Read and clear the latest signal (so each alert acts once).
    take() {
      const s = latest;
      latest = null;
      return s;
    },
    peek: () => latest,
    count: () => received,
    get port() {
      return server.address()?.port ?? port;
    },
  };
}

// Host and secret for live mode. --host beats WEBHOOK_HOST, and the default is
// loopback. The secret comes only from the environment, never a flag, so it
// stays out of shell history and process lists. Empty counts as unset.
export function webhookOptions(opts = {}, env = {}) {
  return {
    host: opts.host || env.WEBHOOK_HOST || "127.0.0.1",
    secret: env.WEBHOOK_SECRET || null,
  };
}

// The startup text. It names the bound address and never the secret.
export function startupMessage({ address, port }, { secured, notes = [] }) {
  const host = address.includes(":") ? `[${address}]` : address;
  let msg = `Webhook listening on http://${host}:${port}/alert — point a TradingView Market Cipher alert here.`;
  if (!secured) {
    msg += "\nWarning: WEBHOOK_SECRET is not set, so any caller that reaches this port can post signals.";
  }
  for (const note of notes) msg += `\n${note}`;
  return msg;
}
