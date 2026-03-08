import { isUUID, normalizeUUID, uuidWithDashes } from "./identity/index.js";
import { fetchPlayerProfile, fetchUsernameByUUID } from "./profile/index.js";

export async function resolvePlayer(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new TypeError("resolvePlayer input must be a non-empty string");
  }

  const raw = input.trim();

  if (isUUID(raw)) {
    const normalized = normalizeUUID(raw);
    const identity = await fetchUsernameByUUID(normalized);
    const profile = await fetchPlayerProfile(identity.name);
    return {
      id: uuidWithDashes(normalized),
      name: identity.name,
      skin: profile.skin ?? null,
      cape: profile.cape ?? null,
    };
  }

  const profile = await fetchPlayerProfile(raw);
  return {
    id: uuidWithDashes(profile.id),
    name: profile.name,
    skin: profile.skin ?? null,
    cape: profile.cape ?? null,
  };
}
