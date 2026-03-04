import { DEFAULT_HEADERS } from "../../constants.js";
import { MinecraftToolkitError } from "../../errors.js";

export async function fetchJson(url, { notFoundMessage, headers } = {}) {
  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...headers,
    },
  });

  if (response.status === 404 && notFoundMessage) {
    throw new MinecraftToolkitError(notFoundMessage, { statusCode: 404 });
  }

  if (!response.ok) {
    throw new MinecraftToolkitError(`Failed to fetch ${url}`, {
      statusCode: response.status,
    });
  }

  return response.json();
}
