import { Buffer } from "node:buffer";
import { fetchJavaServerStatus } from "./status.js";
import { MinecraftToolkitError } from "../errors.js";

export async function fetchServerIcon(address, options = {}) {
  const status = await fetchJavaServerStatus(address, options);
  const favicon = status?.favicon ?? status?.raw?.favicon;
  if (!favicon || typeof favicon !== "string") {
    throw new MinecraftToolkitError("Server did not expose a favicon", { statusCode: 404 });
  }

  const base64 = extractBase64(favicon);
  const buffer = Buffer.from(base64, "base64");

  return {
    host: status.host,
    port: status.port,
    dataUri: `data:image/png;base64,${base64}`,
    base64,
    buffer,
    byteLength: buffer.byteLength,
  };
}

function extractBase64(favicon) {
  const prefix = "data:image/png;base64,";
  return favicon.startsWith(prefix) ? favicon.slice(prefix.length) : favicon;
}
