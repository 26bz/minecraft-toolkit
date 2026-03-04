import { fetchJavaServerStatus } from "./java/status.js";
import { fetchBedrockServerStatus } from "./bedrock/status.js";
import { MinecraftToolkitError } from "../errors.js";

export { fetchJavaServerStatus } from "./java/status.js";
export { fetchBedrockServerStatus } from "./bedrock/status.js";

export async function fetchServerStatus(address, options = {}) {
  const { edition, type, ...rest } = options;
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
