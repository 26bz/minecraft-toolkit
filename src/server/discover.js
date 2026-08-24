import { fetchJavaServerStatus } from "./java/status.js";
import { fetchBedrockServerStatus } from "./bedrock/status.js";
import { MinecraftToolkitError } from "../errors.js";

export async function discoverServer(address, options = {}) {
  const { javaPort, bedrockPort, timeoutMs, protocolVersion, ...rest } = options;

  const [javaResult, bedrockResult] = await Promise.all([
    fetchJavaServerStatus(address, { ...rest, port: javaPort, timeoutMs, protocolVersion })
      .then((status) => ({ status, error: null }))
      .catch((error) => ({ status: null, error })),
    fetchBedrockServerStatus(address, { ...rest, port: bedrockPort, timeoutMs })
      .then((status) => ({ status, error: null }))
      .catch((error) => ({ status: null, error })),
  ]);

  if (javaResult.status) {
    return javaResult.status;
  }
  if (bedrockResult.status) {
    return bedrockResult.status;
  }

  throw new MinecraftToolkitError(`Unable to discover a Java or Bedrock server at ${address}`, {
    statusCode: javaResult.error?.statusCode ?? bedrockResult.error?.statusCode ?? 500,
    cause: bedrockResult.error ?? javaResult.error,
  });
}
