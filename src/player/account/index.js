import { DEFAULT_HEADERS } from "../../constants.js";
import { MinecraftToolkitError } from "../../errors.js";
import { fetchJson } from "../../utils/http/index.js";

const API_BASE = "https://api.minecraftservices.com";

function assertAccessToken(accessToken) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new MinecraftToolkitError("A valid access token is required", { statusCode: 401 });
  }
  return accessToken;
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${assertAccessToken(accessToken)}`,
  };
}

export async function fetchNameChangeInfo(accessToken) {
  return fetchJson(`${API_BASE}/minecraft/profile/namechange`, {
    headers: authHeaders(accessToken),
  });
}

export async function checkNameAvailability(name, accessToken) {
  if (!name || typeof name !== "string") {
    throw new MinecraftToolkitError("Name is required", { statusCode: 400 });
  }
  return fetchJson(`${API_BASE}/minecraft/profile/name/${encodeURIComponent(name)}/available`, {
    headers: authHeaders(accessToken),
  });
}

export async function validateGiftCode(code, accessToken) {
  if (!code || typeof code !== "string") {
    throw new MinecraftToolkitError("Gift code is required", { statusCode: 400 });
  }

  const response = await fetch(`${API_BASE}/productvoucher/giftcode/${encodeURIComponent(code)}`, {
    headers: {
      ...DEFAULT_HEADERS,
      ...authHeaders(accessToken),
    },
  });

  if (response.status === 200 || response.status === 204) {
    return true;
  }

  if (response.status === 404) {
    return false;
  }

  throw new MinecraftToolkitError(`Failed to validate gift code ${code}`, {
    statusCode: response.status,
  });
}

export async function fetchBlockedServers() {
  const response = await fetch(`https://sessionserver.mojang.com/blockedservers`, {
    headers: DEFAULT_HEADERS,
  });

  if (!response.ok) {
    throw new MinecraftToolkitError("Unable to fetch blocked servers", {
      statusCode: response.status,
    });
  }

  const text = await response.text();
  return text
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
