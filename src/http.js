/**
 * One HTTP helper for every outbound call. Centralises four things the old
 * inline fetches each got wrong in their own way:
 *
 *   1. Timeout — every request is bounded (default 10s). Without this a
 *      blackholed route hangs the run for the OS TCP timeout (~2 min under
 *      undici) and, in auto mode, blocks the fallback from even starting.
 *   2. Error body — on a non-2xx we parse the JSON body and surface its `msg`,
 *      instead of throwing away the one field that says what went wrong.
 *   3. `recoverable` tag — network / timeout / non-JSON failures are tagged
 *      `recoverable` (INCLUDING failures while reading the body, which undici
 *      streams lazily after the headers arrive), so the auto data-source
 *      wrapper can tell a real outage (fall back) from a programming error.
 *      An HTTP failure is only tagged `recoverable` when the status itself is
 *      transient (408, 429, 5xx); a permanent 4xx (401, 404, ...) is not,
 *      since retrying it can't succeed and just repeats a broken request.
 *      That classification runs on the status alone, so a non-JSON error
 *      body (an HTML page from a proxy) can't smuggle a 401 into a retry.
 *   4. Retry — opt-in (`retries`) for idempotent GETs, so a single transient
 *      timeout doesn't kill a long replay. Never used for order POSTs.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_DELAY_MS = 10_000;

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

// 408 (request timeout) and 429 (rate limited) are transient like a 5xx.
// Every other 4xx is a permanent client error (bad auth, bad params, not
// found) that a retry cannot fix — tagging it recoverable just re-sends the
// same broken request, which is actively harmful against a rate limited
// exchange endpoint.
function isRecoverableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Delay before the retry that follows a failed `attempt` (zero indexed: the
// delay before attempt 2 uses attempt=0). Exponential base, +/-25% jitter so
// several callers retrying at once don't all wake in lockstep and hammer a
// recovering endpoint together. The base is capped at MAX_RETRY_DELAY_MS
// *before* the jitter multiply: capping after it would collapse every draw
// past attempt 6 onto exactly the cap and bring the lockstep wake-up back.
// The result is clamped once more so the cap is never exceeded, which leaves
// capped attempts spread across [0.75 * cap, cap]. `random` is injectable so
// tests can assert exact delays instead of asserting on distributions.
function backoffDelay(attempt, retryDelayMs, random) {
  const base = Math.min(retryDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
  const jitterFactor = 0.75 + random() * 0.5; // uniform in [0.75, 1.25]
  return Math.min(base * jitterFactor, MAX_RETRY_DELAY_MS);
}

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
  let parseFailed = false;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
  }

  // Classify a non-2xx by its status FIRST, whatever the body looks like. A
  // proxy's HTML error page on a 401 is still a 401: retrying can't fix it,
  // and the caller needs to see the status, not a parse complaint (ELI-260).
  if (!res.ok) {
    const suffix = json?.msg ? `: ${json.msg}` : parseFailed ? " (non-JSON body)" : "";
    const message = `HTTP ${res.status} from ${hostOf(url)}${suffix}`;
    if (isRecoverableStatus(res.status)) throw recoverable(message);
    throw new Error(message);
  }

  // A 2xx whose body isn't JSON is a transport-level surprise (truncated
  // stream, captive portal), so it stays recoverable.
  if (parseFailed) {
    throw recoverable(`non-JSON response from ${hostOf(url)} (HTTP ${res.status})`);
  }

  return json;
}

// opts: { method, headers, body, timeoutMs, retries, retryDelayMs, sleep, random }
// retries defaults to 0 — pass it ONLY for idempotent GETs (never order POSTs,
// which must not be re-sent on a transient error).
// `sleep` and `random` are test seams (default to the real sleeper and
// Math.random) so the backoff schedule can be asserted without waiting on
// the wall clock or asserting on randomness directly.
export async function fetchJson(url, opts = {}) {
  const {
    retries = 0,
    retryDelayMs = 400,
    sleep: sleepFn = sleep,
    random = Math.random,
    ...rest
  } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptFetch(url, rest);
    } catch (err) {
      if (!err.recoverable || attempt >= retries) throw err;
      await sleepFn(backoffDelay(attempt, retryDelayMs, random));
    }
  }
}
