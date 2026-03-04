import { MinecraftToolkitError } from "../../errors.js";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;
const UUID_HEX = /^[0-9a-fA-F]+$/;

export function isValidUsername(username) {
  return typeof username === "string" && USERNAME_REGEX.test(username.trim());
}

export function isUUID(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.replace(/-/g, "");
  return normalized.length === 32 && UUID_HEX.test(normalized);
}

export function normalizeUUID(uuid) {
  if (!isUUID(uuid)) {
    throw new MinecraftToolkitError("Invalid UUID", { statusCode: 400 });
  }
  return uuidWithoutDashes(uuid).toLowerCase();
}

export function uuidWithDashes(uuid) {
  const compact = uuidWithoutDashes(uuid);
  return compact.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

export function uuidWithoutDashes(uuid) {
  if (typeof uuid !== "string") {
    return uuid;
  }
  return uuid.replace(/-/g, "");
}
