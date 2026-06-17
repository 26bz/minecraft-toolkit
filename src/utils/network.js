import { validatePort } from "./validation.js";

export function resolveAddress(address, overridePort, fallbackPort) {
  if (overridePort !== undefined && overridePort !== null) {
    return { host: address, port: validatePort(overridePort) };
  }

  const bracketed = address.match(/^(\[[^\]]+\]):(\d+)$/);
  if (bracketed) {
    return { host: bracketed[1], port: validatePort(bracketed[2]) };
  }

  // Only treat as "host:port" when there is exactly one colon.
  const colonCount = (address.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const lastColon = address.lastIndexOf(":");
    const potentialPort = address.slice(lastColon + 1);
    if (potentialPort !== "") {
      return { host: address.slice(0, lastColon), port: validatePort(potentialPort) };
    }
  }

  return { host: address, port: fallbackPort };
}
