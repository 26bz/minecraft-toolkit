import { DEFAULT_HEADERS } from "../../constants.js";
import { MinecraftToolkitError } from "../../errors.js";

export async function fetchRequest(url, options = {}) {
  try {
    return await fetch(url, {
      ...options,
      headers: {
        ...DEFAULT_HEADERS,
        ...options.headers,
      },
    });
  } catch (error) {
    throw new MinecraftToolkitError(`Failed to fetch ${safeUrl(url)}`, {
      statusCode: 502,
      cause: error,
    });
  }
}

export async function fetchJson(url, { notFoundMessage, headers } = {}) {
  const response = await fetchRequest(url, { headers });

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
