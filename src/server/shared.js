import { DEFAULT_TIMEOUT_MS } from "../constants.js";
import { MinecraftToolkitError } from "../errors.js";

export function resolveTimeout(timeout) {
  if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0) {
    return timeout;
  }
  return DEFAULT_TIMEOUT_MS;
}

export function makeError(message, cause) {
  return new MinecraftToolkitError(message, { cause });
}
