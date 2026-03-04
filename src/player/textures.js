import { MinecraftToolkitError } from "../errors.js";

export function decodeTexturePayload(properties = []) {
  const texturesProperty = properties.find((prop) => prop.name === "textures");
  if (!texturesProperty?.value) {
    return null;
  }

  try {
    const decoded = Buffer.from(texturesProperty.value, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    throw new MinecraftToolkitError("Unable to decode Mojang texture payload", {
      statusCode: 500,
      cause: error,
    });
  }
}

export function getSkinURL(profile) {
  return profile?.skin?.url ?? null;
}

export function getCapeURL(profile) {
  return profile?.cape?.url ?? null;
}

export function getSkinModel(profile) {
  const model = profile?.skin?.metadata?.model;
  return model === "slim" ? "slim" : "default";
}

export function extractTextureHash(url) {
  if (!url) {
    return null;
  }
  const match = url.match(/\/texture\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}
