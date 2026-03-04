import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export const PACKAGE_METADATA = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
};

export const DEFAULT_JAVA_PORT = 25565;
export const DEFAULT_BEDROCK_PORT = 19132;
export const DEFAULT_CACHE_TTL_SECONDS = 30;
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_PROTOCOL_VERSION = 760; // Minecraft 1.20.4

export const MOJANG_PROFILE_BASE = "https://api.mojang.com/users/profiles/minecraft";
export const SESSION_PROFILE_BASE = "https://sessionserver.mojang.com/session/minecraft/profile";
export const NAME_HISTORY_BASE = "https://api.mojang.com/user/profiles";

export const USER_AGENT = `${pkg.name}/${pkg.version}`;
export const DEFAULT_HEADERS = {
  accept: "application/json",
  "user-agent": USER_AGENT,
};

export const RAKNET_MAGIC = Buffer.from([
  0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe, 0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78,
]);
