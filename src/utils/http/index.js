import { DEFAULT_HEADERS } from "../../constants.js";
import { MinecraftToolkitError } from "../../errors.js";

const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

export async function fetchRequest(url, options = {}) {
  const { timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, signal, ...init } = options;
  try {
    return await fetch(url, {
      ...init,
      signal: buildSignal(signal, timeoutMs),
      headers: {
        ...DEFAULT_HEADERS,
        ...init.headers,
      },
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new MinecraftToolkitError(`Timed out fetching ${safeUrl(url)}`, {
        statusCode: 504,
        cause: error,
      });
    }
    if (error?.name === "AbortError") {
      throw new MinecraftToolkitError(`Request to ${safeUrl(url)} was aborted`, {
        statusCode: 499,
        cause: error,
      });
    }
    throw new MinecraftToolkitError(`Failed to fetch ${safeUrl(url)}`, {
      statusCode: 502,
      cause: error,
    });
  }
}

function buildSignal(signal, timeoutMs) {
  if (!(typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    return signal;
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function fetchJson(url, { notFoundMessage, headers, timeoutMs, signal } = {}) {
  const response = await fetchRequest(url, { headers, timeoutMs, signal });

  if (response.status === 404 && notFoundMessage) {
    throw new MinecraftToolkitError(notFoundMessage, { statusCode: 404 });
  }

  if (response.status === 429) {
    const raw = response.headers.get("retry-after");
    const retryAfter = raw !== null ? Number.parseInt(raw, 10) : null;
    throw new MinecraftToolkitError("Mojang API rate limit exceeded", {
      statusCode: 429,
      retryAfter: retryAfter !== null && !Number.isNaN(retryAfter) ? retryAfter : null,
    });
  }

  if (!response.ok) {
    throw new MinecraftToolkitError(`Failed to fetch ${safeUrl(url)}`, {
      statusCode: response.status,
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw new MinecraftToolkitError("Failed to parse response as JSON", {
      statusCode: 500,
      cause: error,
    });
  }
}

function safeUrl(url) {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return "[url]";
  }
}

const DEFAULT_RETRIES = 3;
const DEFAULT_MIN_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

export async function withRetry(fn, options = {}) {
  const {
    retries = DEFAULT_RETRIES,
    minDelayMs = DEFAULT_MIN_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    onRetry,
  } = options;

  let attempt = 0;

  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      const isRateLimited = error instanceof MinecraftToolkitError && error.statusCode === 429;
      if (!isRateLimited || attempt >= retries) {
        throw error;
      }

      const retryAfterMs =
        typeof error.retryAfter === "number" && Number.isFinite(error.retryAfter)
          ? error.retryAfter * 1000
          : null;
      const delayMs = Math.min(maxDelayMs, retryAfterMs ?? minDelayMs * 2 ** attempt);

      attempt += 1;
      onRetry?.({ attempt, delayMs, error });
      await wait(delayMs);
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
