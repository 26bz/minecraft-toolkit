import { validatePort } from "./validation.js";

export function resolveAddress(address, overridePort, fallbackPort) {
  if (overridePort) {
    return { host: address, port: validatePort(overridePort) };
  }

  const parts = address.split(":");
  if (parts.length > 1 && parts[parts.length - 1] !== "") {
    const extractedPort = parts.pop();
    return { host: parts.join(":"), port: validatePort(extractedPort) };
  }

  return { host: address, port: fallbackPort };
}
