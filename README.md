# minecraft-toolkit

<!-- automd:badges name="minecraft-toolkit" github="26bz/minecraft-toolkit" license -->

[![npm version](https://img.shields.io/npm/v/minecraft-toolkit)](https://npmjs.com/package/minecraft-toolkit)
[![npm downloads](https://img.shields.io/npm/dm/minecraft-toolkit)](https://npm.chart.dev/minecraft-toolkit)
[![license](https://img.shields.io/github/license/26bz/minecraft-toolkit)](https://github.com/26bz/minecraft-toolkit/blob/main/LICENSE)

<!-- /automd -->

Lightweight Mojang player utilities (profile, skin, UUID) for Node, Vite, and edge projects.

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
const skinUrl = getSkinURL(await fetchPlayerProfile("26bz"));
const hash = extractTextureHash(skinUrl);
const model = getSkinModel(skinUrl); // "slim" | "classic"
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

## License

Published under the [MIT](https://github.com/26bz/minecraft-toolkit/blob/main/LICENSE) license.
Made by [26bz](https://github.com/26bz)
<br><br>
<a href="https://github.com/26bz/minecraft-toolkit/graphs/contributors">
<img src="https://contrib.rocks/image?repo=26bz/minecraft-toolkit" />
</a>
