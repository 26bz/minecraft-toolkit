# minecraft-toolkit

<!-- automd:badges name="minecraft-toolkit" github="26bz/minecraft-toolkit" license -->

[![npm version](https://img.shields.io/npm/v/minecraft-toolkit)](https://npmjs.com/package/minecraft-toolkit)
[![npm downloads](https://img.shields.io/npm/dm/minecraft-toolkit)](https://npm.chart.dev/minecraft-toolkit)
[![license](https://img.shields.io/github/license/26bz/minecraft-toolkit)](https://github.com/26bz/minecraft-toolkit/blob/main/LICENSE)

<!-- /automd -->

Lightweight Minecraft API + infrastructure toolkit: player profiles & textures, Java/Bedrock server status probes, and Votifier (v1/v2) clients that run in Node, Vite, and edge runtimes.

> This toolkit wraps Mojang APIs. Rate limits and availability still apply. Write endpoints (name change, skin upload) are not yet included.

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
  fetchNameHistory,
  fetchPlayers,
  resolvePlayer,
  fetchSkinMetadata,
} from "minecraft-toolkit";

const profile = await fetchPlayerProfile("26bz");
const summary = await fetchPlayerSummary("26bz");
const skin = await fetchPlayerSkin("26bz");
const uuid = await fetchPlayerUUID("26bz");
const history = await fetchNameHistory("069a79f444e94726a5befca90e38aaf5");
const batch = await fetchPlayers(["Notch", "26bz"], { delayMs: 50 });
const resolved = await resolvePlayer("069a79f444e94726a5befca90e38aaf5");
const skinMeta = await fetchSkinMetadata("26bz");
```

Helpers are HTTP-agnostic and run anywhere `fetch` exists (Node 18+, Bun, Workers). All errors surface as `MinecraftToolkitError`.

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

## License

Published under the [MIT](https://github.com/26bz/minecraft-toolkit/blob/main/LICENSE) license.
Made by [26bz](https://github.com/26bz)
<br><br>
<a href="https://github.com/26bz/minecraft-toolkit/graphs/contributors">
<img src="https://contrib.rocks/image?repo=26bz/minecraft-toolkit" />
</a>
