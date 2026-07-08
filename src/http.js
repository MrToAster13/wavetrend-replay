/**
 * One HTTP helper for every outbound call. Centralises four things the old
 * inline fetches each got wrong in their own way:
 *
 *   1. Timeout — every request is bounded (default 10s). Without this a
 *      blackholed route hangs the run for the OS TCP timeout (~2 min under
 *      undici) and, in auto mode, blocks the fallback from even starting.
 *   2. Error body — on a non-2xx we parse the JSON body and surface its `msg`,
 *      instead of throwing away the one field that says what went wrong.
 *   3. `recoverable` tag — network / timeout / HTTP / non-JSON failures are
 *      tagged `recoverable` (INCLUDING failures while reading the body, which
 *      undici streams lazily after the headers arrive), so the auto data-source
 *      wrapper can tell a real outage (fall back) from a programming error.
 *   4. Retry — opt-in (`retries`) for idempotent GETs, so a single transient
 *      timeout doesn't kill a long replay. Never used for order POSTs.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function recoverable(message) {
  const err = new Error(message);
  err.recoverable = true;
  return err;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function attemptFetch(url, { method = "GET", headers, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let res;
  let text;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    // The body is streamed lazily, so a transport failure or timeout can strike
    // HERE, after the headers arrived — keep it inside the tagged try.
    text = await res.text();
  } catch (err) {
    const detail = err?.cause?.code || err?.cause?.message || err?.message;
    throw recoverable(`request to ${hostOf(url)} failed: ${detail}`);
  }

  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw recoverable(`non-JSON response from ${hostOf(url)} (HTTP ${res.status})`);
    }
  }

  if (!res.ok) {
    const suffix = json?.msg ? `: ${json.msg}` : "";
    throw recoverable(`HTTP ${res.status} from ${hostOf(url)}${suffix}`);
  }

  return json;
}

// opts: { method, headers, body, timeoutMs, retries, retryDelayMs }
// retries defaults to 0 — pass it ONLY for idempotent GETs (never order POSTs,
// which must not be re-sent on a transient error).
export async function fetchJson(url, opts = {}) {
  const { retries = 0, retryDelayMs = 400, ...rest } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptFetch(url, rest);
    } catch (err) {
      if (!err.recoverable || attempt >= retries) throw err;
      await sleep(retryDelayMs);
    }
  }
}
