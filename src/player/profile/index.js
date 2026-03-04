import { MOJANG_PROFILE_BASE, SESSION_PROFILE_BASE, NAME_HISTORY_BASE } from "../../constants.js";
import { MinecraftToolkitError } from "../../errors.js";
import { fetchJson } from "../../utils/http/index.js";
import { normalizeUsername } from "../../utils/validation.js";
import { decodeTexturePayload, getSkinURL, getCapeURL, extractTextureHash } from "../textures.js";

export async function fetchPlayerProfile(username) {
  const normalizedUsername = normalizeUsername(username);
  const identity = await fetchJson(
    `${MOJANG_PROFILE_BASE}/${encodeURIComponent(normalizedUsername)}`,
    {
      notFoundMessage: "Player not found",
    },
  );

  const sessionProfile = await fetchJson(`${SESSION_PROFILE_BASE}/${identity.id}`);
  const texturePayload = decodeTexturePayload(sessionProfile.properties);

  return {
    id: identity.id,
    name: identity.name,
    profile: sessionProfile,
    textures: texturePayload?.textures ?? {},
    skin: texturePayload?.textures?.SKIN ?? null,
    cape: texturePayload?.textures?.CAPE ?? null,
  };
}

export async function playerExists(username) {
  const normalizedUsername = normalizeUsername(username);
  try {
    await fetchJson(`${MOJANG_PROFILE_BASE}/${encodeURIComponent(normalizedUsername)}`);
    return true;
  } catch (error) {
    if (error instanceof MinecraftToolkitError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

export async function fetchPlayerSummary(username) {
  const profile = await fetchPlayerProfile(username);
  return {
    id: profile.id,
    name: profile.name,
    skinUrl: getSkinURL(profile),
    capeUrl: getCapeURL(profile),
  };
}

export function hasSkinChanged(profileA, profileB) {
  const hashA = extractTextureHash(getSkinURL(profileA));
  const hashB = extractTextureHash(getSkinURL(profileB));
  return hashA !== hashB;
}

export async function fetchPlayerSkin(username) {
  const profile = await fetchPlayerProfile(username);
  return {
    id: profile.id,
    name: profile.name,
    skin: profile.skin,
    cape: profile.cape,
  };
}

export async function fetchPlayerUUID(username) {
  const profile = await fetchPlayerProfile(username);
  return {
    id: profile.id,
    name: profile.name,
  };
}

export async function fetchUsernameByUUID(uuid) {
  const response = await fetchJson(`${SESSION_PROFILE_BASE}/${uuid}`, {
    notFoundMessage: "UUID not found",
  });
  return {
    id: response.id,
    name: response.name,
  };
}

export async function fetchNameHistory(uuid) {
  const entries = await fetchJson(`${NAME_HISTORY_BASE}/${uuid}/names`, {
    notFoundMessage: "UUID not found",
  });
  return Array.isArray(entries)
    ? entries.map((entry) => ({
        name: entry.name,
        changedAt: entry.changedToAt ? new Date(entry.changedToAt) : null,
      }))
    : [];
}

export async function fetchPlayers(usernames, options = {}) {
  const { delayMs = 100, signal } = options;
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return [];
  }

  const deduped = Array.from(new Set(usernames.map((name) => normalizeUsername(name))));
  const results = [];

  for (let index = 0; index < deduped.length; index += 1) {
    const username = deduped[index];
    if (signal?.aborted) {
      throw new MinecraftToolkitError("Batch fetch aborted", { statusCode: 499 });
    }

    try {
      const profile = await fetchPlayerProfile(username);
      results.push({ username, profile });
    } catch (error) {
      results.push({ username, error });
    }

    if (index < deduped.length - 1 && delayMs > 0) {
      await wait(delayMs, signal);
    }
  }

  return results;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new MinecraftToolkitError("Batch fetch aborted", { statusCode: 499 }));
    }

    if (signal) {
      signal.addEventListener?.("abort", onAbort, { once: true });
    }
  });
}
