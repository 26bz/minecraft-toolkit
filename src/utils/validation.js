import { MinecraftToolkitError } from "../errors.js";

export function normalizeAddress(address) {
  if (!address || typeof address !== "string") {
    throw new MinecraftToolkitError("Server address is required", { statusCode: 400 });
  }

  return address.trim();
}

export function normalizeUsername(username) {
  if (!username || typeof username !== "string") {
    throw new MinecraftToolkitError("Username is required", { statusCode: 400 });
  }

  return username.trim();
}

export function validatePort(port) {
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new MinecraftToolkitError("Port must be an integer between 1 and 65535", {
      statusCode: 400,
    });
  }

  return parsed;
}
