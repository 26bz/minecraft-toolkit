import { PNG } from "pngjs";
import { MinecraftToolkitError } from "../errors.js";
import { fetchRequest } from "./http/index.js";

export async function decodePngFromUrl(url) {
  const response = await fetchRequest(url);
  if (!response.ok) {
    throw new MinecraftToolkitError("Unable to load PNG texture", {
      statusCode: response.status,
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  try {
    return PNG.sync.read(buffer);
  } catch (error) {
    throw new MinecraftToolkitError("Unable to decode PNG texture", {
      statusCode: 500,
      cause: error,
    });
  }
}
