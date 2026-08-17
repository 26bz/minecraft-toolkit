# minecraft-toolkit

<!-- automd:badges name="minecraft-toolkit" github="26bz/minecraft-toolkit" license -->

[![npm version](https://img.shields.io/npm/v/minecraft-toolkit)](https://npmjs.com/package/minecraft-toolkit)
[![npm downloads](https://img.shields.io/npm/dm/minecraft-toolkit)](https://npm.chart.dev/minecraft-toolkit)
[![license](https://img.shields.io/github/license/26bz/minecraft-toolkit)](https://github.com/26bz/minecraft-toolkit/blob/main/LICENSE)

<!-- /automd -->

Lightweight Minecraft API + infrastructure toolkit: player profiles & textures, Java/Bedrock server status probes, and Votifier (v1/v2) clients for Node and other fetch-capable runtimes. Some helpers rely on Node networking or binary modules.

> This toolkit wraps Mojang APIs. Rate limits and availability still apply. Write endpoints (name change, skin upload) are not yet included.

> ESM-only: this package ships as `"type": "module"` with no CommonJS build. Use `import`, or dynamic `import()` from CommonJS.

## Installation

<!-- automd:pm-install name="minecraft-toolkit" -->

```sh
# ✨ Auto-detect
npx nypm install minecraft-toolkit

# npm
npm install minecraft-toolkit

# yarn
yarn add minecraft-toolkit

# pnpm
pnpm install minecraft-toolkit

# bun
bun install minecraft-toolkit

# deno
deno install minecraft-toolkit
```

<!-- /automd -->

## Core Helpers

```ts
import {
  fetchPlayerProfile,
  fetchPlayerSkin,
  fetchPlayerUUID,
  fetchPlayerSummary,
  fetchPlayers,
  resolvePlayer,
  fetchSkinMetadata,
} from "minecraft-toolkit";

const profile = await fetchPlayerProfile("26bz");
const summary = await fetchPlayerSummary("26bz");
const skin = await fetchPlayerSkin("26bz");
const uuid = await fetchPlayerUUID("26bz");
const batch = await fetchPlayers(["Notch", "26bz"], { delayMs: 50 });
const resolved = await resolvePlayer("069a79f444e94726a5befca90e38aaf5");
const skinMeta = await fetchSkinMetadata("26bz");
```

Fetch-based helpers run anywhere `fetch` exists (Node 18+, Bun, Workers). Node networking and PNG helpers are not edge-safe. All API-style failures surface as `MinecraftToolkitError`.

## Texture & Identity Utilities

```ts
import {
  isValidUsername,
  isUUID,
  normalizeUUID,
  uuidWithDashes,
  uuidWithoutDashes,
  getSkinURL,
  getCapeURL,
  getSkinModel,
  extractTextureHash,
} from "minecraft-toolkit";

isValidUsername("26bz"); // true
uuidWithDashes("069a79f444e94726a5befca90e38aaf5");
const profile = await fetchPlayerProfile("26bz");
const skinUrl = getSkinURL(profile);
const hash = extractTextureHash(skinUrl);
const model = getSkinModel(profile); // "slim" | "default"
```

## Skin Metadata & Color Sampling

```ts
import { fetchSkinMetadata, computeSkinDominantColor } from "minecraft-toolkit";

const meta = await fetchSkinMetadata("26bz", {
  dominantColor: true,
  sampleRegion: { x: 8, y: 8, width: 8, height: 8 },
});

console.log(meta.dominantColor); // e.g. "#f2d2a9"

const accent = await computeSkinDominantColor(meta.skin.url, {
  x: 40,
  y: 8,
  width: 8,
  height: 8,
});
```

## Skin Rendering

Composite a skin texture into a ready-to-use PNG (`buffer`, `base64`, and `dataUri`), without pulling in a canvas dependency. Accepts a username, UUID, or a raw skin URL.

```ts
import { renderPlayerHead, renderPlayerBust } from "minecraft-toolkit";

const head = await renderPlayerHead("26bz", { size: 128 }); // face + hat overlay
const bust = await renderPlayerBust("26bz", { size: 128 }); // head + torso + arms

console.log(head.dataUri); // "data:image/png;base64,..."
```

- `overlay` (default `true`) toggles the hat/jacket/sleeve overlay layers.
- `model` forces `"default"` or `"slim"` arm width when rendering from a raw skin URL (model is auto-detected when resolving by username/UUID).
- `renderPlayerBust` mirrors the right arm for legacy 64x32 skins that don't carry left-limb pixel data.
- `size` is an upscale target for the image's longest native dimension using nearest-neighbor scaling (integer multiples only, so output size is always a whole multiple of the native resolution). It never downscales below native resolution — requesting a `size` smaller than native returns the unscaled image.

## Caching & Retries

The internal response cache and a rate-limit-aware retry helper are exposed for building your own resilient wrappers around any of the fetch-based helpers.

```ts
import { createCache, withCache, withRetry, fetchPlayerProfile } from "minecraft-toolkit";

const cache = createCache({ ttlSeconds: 30 });

const profile = await withRetry(() =>
  withCache(cache, "profile:26bz", () => fetchPlayerProfile("26bz")),
);
```

- `withRetry(fn, options)` retries only on `MinecraftToolkitError` with `statusCode: 429`, honoring the Mojang `Retry-After` header (`retryAfter`) when present and falling back to exponential backoff (`minDelayMs`/`maxDelayMs`, default 3 retries).
- `createCache({ ttlSeconds, maxSize })` returns a `ResponseCache` (or `null` when `{ cache: false }`); `withCache(cache, key, resolver)` is a no-op passthrough when `cache` is `null`.

## Server Status Watcher

Poll a server on an interval and only get notified when something actually changes (online state, player count, or MOTD) — no need to hand-roll diffing for a status page or Discord bot.

```ts
import { watchServerStatus } from "minecraft-toolkit";

const watcher = watchServerStatus("mc.hypixel.net", {
  intervalMs: 30_000,
  onChange: (status, previous) => console.log(`players: ${status.players.online}`),
  onError: (error) => console.error(error),
});

// later
watcher.stop();
```

`onUpdate` fires on every poll; `onChange` fires only when `online`, `players.online`, `players.max`, or `motd` differ from the previous poll. Accepts the same options as `fetchServerStatus`. `intervalMs` is clamped to a 1000ms floor to avoid hammering the target server.

## Account Helpers

A valid Microsoft/Xbox Live access token is required for `minecraftservices.com` endpoints. Missing or expired tokens throw `MinecraftToolkitError` with `statusCode: 401`.

```ts
import {
  fetchNameChangeInfo,
  checkNameAvailability,
  validateGiftCode,
  fetchBlockedServers,
} from "minecraft-toolkit";

const accessToken = process.env.MC_ACCESS_TOKEN;

const windowInfo = await fetchNameChangeInfo(accessToken);
const availability = await checkNameAvailability("fresh_name", accessToken);
const isGiftValid = await validateGiftCode("ABCD-1234", accessToken);
const blockedServer = await fetchBlockedServers(); // no token required
```

`validateGiftCode` returns `true`/`false` for 200/404 responses without throwing.

## Server Status Helpers

Probe Java and Bedrock servers without bringing your own RakNet/TCP logic.

```ts
import {
  fetchServerStatus,
  fetchJavaServerStatus,
  fetchBedrockServerStatus,
} from "minecraft-toolkit";

const javaStatus = await fetchJavaServerStatus("mc.hypixel.net", { port: 25565 });
const bedrockStatus = await fetchBedrockServerStatus("play.example.net", { port: 19132 });

// fetchServerStatus picks the right probe based on the `edition` field
const autoStatus = await fetchServerStatus("my.realm.net", { edition: "bedrock" });

console.log(javaStatus.players.online, bedrockStatus.motd);
```

Both helpers normalize MOTD text, favicon/Base64 icons, latency, and version info. Errors surface as
`MinecraftToolkitError` with contextual status codes.

### Server Icon Helper

```ts
import { fetchServerIcon } from "minecraft-toolkit";

const icon = await fetchServerIcon("play.example.net");
console.log(icon.base64); // "iVBOR..."
console.log(icon.byteLength); // raw PNG size in bytes
```

The helper reuses the Java status ping to extract the favicon, returning:

- `dataUri`: ready-to-render `data:image/png;base64,...`
- `base64`: raw Base64 payload
- `buffer` + `byteLength` for further processing (e.g., resizing, hashing)

If the server doesn’t expose an icon, it throws `MinecraftToolkitError` (404).

## Votifier Client (Java)

Send vote notifications to classic Votifier v1 (RSA public key) and NuVotifier v2 (token/HMAC) servers without re-implementing either protocol.

```ts
import { sendVotifierVote } from "minecraft-toolkit";

const result = await sendVotifierVote({
  host: "votifier.myserver.net",
  port: 8192, // defaults to 8192 if omitted
  publicKey: process.env.VOTIFIER_PUBLIC_KEY, // v1 servers
  serviceName: "MyTopList",
  username: "26bz",
  address: "198.51.100.42",
  token: listingSiteConfig.token, // v2 servers (optional)
  protocol: "auto", // let the handshake decide between v1/v2
});

console.log(result.acknowledged, result.version, result.protocol);
```

- Provide either a legacy RSA public key (for protocol v1) **or** a NuVotifier token (protocol v2). Server listing sites typically store each server's token and pass it here; `protocol: "auto"` will select the right flow based on the handshake.
- `timestamp` accepts a `Date` or millisecond value (default: `Date.now()`). All failures bubble as `MinecraftToolkitError`.

## Minecraft Formatting Renderer

Convert legacy `§` or `&` codes into safe HTML fragments or CSS class spans.

```ts
import { toHTML, generateCSS, stripCodes, hasCodes, convertPrefix } from "minecraft-toolkit";

const motd = "§aWelcome §lHeroes§r!";

const inline = toHTML(motd); // <span style="color: #55ff55">Welcome ...</span>

const classes = toHTML(motd, { mode: "class", classPrefix: "mc" });
const css = generateCSS(); // drop into a <style> tag

stripCodes(motd); // "Welcome Heroes!"
hasCodes(motd); // true
convertPrefix("&aHi", "toSection"); // "§aHi"
```

`getMaps()` exposes the color and format metadata if you want to build custom renderers.

## HTTP Routes (h3)

Mount ready-made REST endpoints for the player, account, and server helpers on top of [h3](https://h3.dev). This is a separate subpath export so that consumers who only need the plain function calls above aren't forced to install h3 — add it yourself first:

```sh
pnpm add h3
```

```ts
import { createPlayerApp } from "minecraft-toolkit/h3";

const { app } = createPlayerApp();

export default app; // or app.request(...) directly, or mount into an existing H3 app
```

- `createPlayerApp(options?)` returns `{ app, handlers }`, a standalone `H3` app with every route below wired up.
- `createPlayerHandlers()` returns the raw `defineHandler` functions if you want to mount them yourself under different paths.
- `playerPlugin` is an `H3` plugin (`app.register(playerPlugin)` / pass to an existing app) that adds the same routes without creating a new app instance.

| Method | Path                               | Notes                                                                         |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/player/:username`                | `fetchPlayerProfile`                                                          |
| GET    | `/player/:username/skin`           | `fetchPlayerSkin`                                                             |
| GET    | `/player/:username/summary`        | `fetchPlayerSummary`                                                          |
| GET    | `/player/:username/uuid`           | `fetchPlayerUUID`                                                             |
| GET    | `/player/:input/resolve`           | `resolvePlayer`                                                               |
| GET    | `/player/:username/exists`         | `playerExists`                                                                |
| POST   | `/players/batch`                   | `fetchPlayers` (body: `{ usernames, delayMs? }`, max 100)                     |
| GET    | `/account/namechange`              | requires `Authorization: Bearer <token>`                                      |
| GET    | `/account/name/:name/availability` | requires `Authorization: Bearer <token>`                                      |
| POST   | `/account/gift-code/validate`      | requires `Authorization: Bearer <token>`, body `{ code }`                     |
| GET    | `/account/blocked-servers`         | `fetchBlockedServers`                                                         |
| GET    | `/server/:address/status`          | `fetchServerStatus`; query: `edition`, `port`, `timeoutMs`, `protocolVersion` |
| GET    | `/server/:address/icon`            | `fetchServerIcon`; query: `port`, `timeoutMs`, `protocolVersion`              |

> **SSRF warning:** the `/server/:address/status` and `/server/:address/icon` routes accept an arbitrary `address`/`port` from the caller and open a raw socket to it, with no allowlist or private-IP blocking. If you mount this app on a publicly reachable server, anyone can use it to probe your internal network (loopback, RFC1918 ranges, cloud metadata endpoints) via response timing/content. Put these routes behind your own allowlist, auth, or network egress restrictions before exposing them publicly.

## License

Published under the [MIT](https://github.com/26bz/minecraft-toolkit/blob/main/LICENSE) license.
Made by [26bz](https://github.com/26bz)
<br><br>
<a href="https://github.com/26bz/minecraft-toolkit/graphs/contributors">
<img src="https://contrib.rocks/image?repo=26bz/minecraft-toolkit" />
</a>
