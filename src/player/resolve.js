import { SESSION_PROFILE_BASE } from "../constants.js";
import { MinecraftToolkitError } from "../errors.js";
import { fetchJson } from "../utils/http/index.js";
import { isUUID, normalizeUUID, uuidWithDashes } from "./identity/index.js";
import { fetchPlayerProfile } from "./profile/index.js";
import { decodeTexturePayload } from "./textures.js";

export async function resolvePlayer(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new MinecraftToolkitError("resolvePlayer input must be a non-empty string", {
      statusCode: 400,
    });
  }

  const raw = input.trim();

  if (isUUID(raw)) {
    const normalized = normalizeUUID(raw);
    const session = await fetchJson(`${SESSION_PROFILE_BASE}/${normalized}`, {
      notFoundMessage: "UUID not found",
    });
    const texturePayload = decodeTexturePayload(session.properties);
    return {
      id: uuidWithDashes(normalized),
      name: session.name,
      skin: texturePayload?.textures?.SKIN ?? null,
      cape: texturePayload?.textures?.CAPE ?? null,
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
