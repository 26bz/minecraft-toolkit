import { fetchJavaServerStatus } from "./java/status.js";
import { fetchBedrockServerStatus } from "./bedrock/status.js";
import { MinecraftToolkitError } from "../errors.js";

export { fetchJavaServerStatus } from "./java/status.js";
export { fetchBedrockServerStatus } from "./bedrock/status.js";

let typeDeprecationWarned = false;

export async function fetchServerStatus(address, options = {}) {
  const { edition, type, ...rest } = options;

  if (type !== undefined && edition === undefined && !typeDeprecationWarned) {
    typeDeprecationWarned = true;
    const msg =
      "[minecraft-toolkit] fetchServerStatus({ type }) is deprecated. Use fetchServerStatus({ edition }) instead.";
    if (typeof process !== "undefined" && typeof process.emitWarning === "function") {
      process.emitWarning(msg, "DeprecationWarning");
    } else {
      console.warn(msg);
    }
  }

  const target =
    (typeof (edition ?? type) === "string" ? (edition ?? type).trim().toLowerCase() : null) ||
    "java";

  if (target === "java") {
    return fetchJavaServerStatus(address, rest);
  }

  if (target === "bedrock") {
    return fetchBedrockServerStatus(address, rest);
  }

  if (target === "auto") {
    let javaError;
    try {
      return await fetchJavaServerStatus(address, rest);
    } catch (error) {
      javaError = error;
    }

    return fetchBedrockServerStatus(address, rest).catch((bedrockError) => {
      throw new MinecraftToolkitError("Unable to query server status", {
        statusCode: bedrockError.statusCode ?? javaError?.statusCode ?? 500,
        cause: bedrockError,
      });
    });
  }

  throw new MinecraftToolkitError('Edition must be "java", "bedrock", or "auto"', {
    statusCode: 400,
  });
}
