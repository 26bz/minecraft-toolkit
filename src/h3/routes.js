import { H3, defineHandler, definePlugin, readBody } from "h3";
import { MinecraftToolkitError } from "../errors.js";
import {
  fetchPlayerProfile,
  fetchPlayerSkin,
  fetchPlayerSummary,
  fetchPlayerUUID,
  fetchPlayers,
  fetchNameHistory,
  playerExists,
} from "../player/profile/index.js";
import { resolvePlayer } from "../player/resolve.js";
import {
  fetchNameChangeInfo,
  checkNameAvailability,
  validateGiftCode,
  fetchBlockedServers,
} from "../player/account/index.js";

function requireParam(event, key, message) {
  const value = event.context.params?.[key];
  if (!value) {
    throw new MinecraftToolkitError(message, { statusCode: 400 });
  }
  return value;
}

export function createPlayerHandlers() {
  const profileHandler = defineHandler(async (event) => {
    const username = requireParam(event, "username", "Username parameter is required");
    return fetchPlayerProfile(username);
  });

  const skinHandler = defineHandler(async (event) => {
    const username = requireParam(event, "username", "Username parameter is required");
    return fetchPlayerSkin(username);
  });

  const summaryHandler = defineHandler(async (event) => {
    const username = requireParam(event, "username", "Username parameter is required");
    return fetchPlayerSummary(username);
  });

  const uuidHandler = defineHandler(async (event) => {
    const username = requireParam(event, "username", "Username parameter is required");
    return fetchPlayerUUID(username);
  });

  const resolverHandler = defineHandler(async (event) => {
    const input = requireParam(event, "input", "Username or UUID parameter is required");
    return resolvePlayer(input);
  });

  const nameHistoryHandler = defineHandler(async (event) => {
    const uuid = requireParam(event, "uuid", "UUID parameter is required");
    return fetchNameHistory(uuid);
  });

  const existsHandler = defineHandler(async (event) => {
    const username = requireParam(event, "username", "Username parameter is required");
    const exists = await playerExists(username);
    return { username, exists };
  });

  const batchHandler = defineHandler(async (event) => {
    const body = (await readBody(event)) ?? {};
    const usernames = Array.isArray(body.usernames) ? body.usernames : null;
    if (!usernames || usernames.length === 0) {
      throw new MinecraftToolkitError("Body must include a non-empty usernames array", { statusCode: 400 });
    }
    const delayMs = typeof body.delayMs === "number" ? body.delayMs : undefined;
    return fetchPlayers(usernames, { delayMs });
  });

  const nameChangeInfoHandler = defineHandler(async (event) => {
    const token = requireAccessToken(event);
    return fetchNameChangeInfo(token);
  });

  const nameAvailabilityHandler = defineHandler(async (event) => {
    const name = requireParam(event, "name", "Name parameter is required");
    const token = requireAccessToken(event);
    return checkNameAvailability(name, token);
  });

  const giftCodeValidationHandler = defineHandler(async (event) => {
    const token = requireAccessToken(event);
    const body = (await readBody(event)) ?? {};
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) {
      throw new MinecraftToolkitError("Gift code is required", { statusCode: 400 });
    }
    const valid = await validateGiftCode(code, token);
    return { code, valid };
  });

  const blockedServersHandler = defineHandler(async () => fetchBlockedServers());

  return {
    profileHandler,
    skinHandler,
    summaryHandler,
    uuidHandler,
    resolverHandler,
    nameHistoryHandler,
    existsHandler,
    batchHandler,
    nameChangeInfoHandler,
    nameAvailabilityHandler,
    giftCodeValidationHandler,
    blockedServersHandler,
  };
}

export function createPlayerApp(options = {}) {
  const app = new H3(options?.app);
  const handlers = createPlayerHandlers();

  app.get("/player/:username", handlers.profileHandler, {
    meta: { category: "player", resource: "profile" },
  });

  app.get("/player/:username/skin", handlers.skinHandler, {
    meta: { category: "player", resource: "skin" },
  });

  app.get("/player/:username/summary", handlers.summaryHandler, {
    meta: { category: "player", resource: "summary" },
  });

  app.get("/player/:username/uuid", handlers.uuidHandler, {
    meta: { category: "player", resource: "uuid" },
  });

  app.get("/player/:input/resolve", handlers.resolverHandler, {
    meta: { category: "player", resource: "resolve" },
  });

  app.get("/player/:uuid/names", handlers.nameHistoryHandler, {
    meta: { category: "player", resource: "name-history" },
  });

  app.get("/player/:username/exists", handlers.existsHandler, {
    meta: { category: "player", resource: "exists" },
  });

  app.post("/players/batch", handlers.batchHandler, {
    meta: { category: "player", resource: "batch" },
  });

  app.get("/account/namechange", handlers.nameChangeInfoHandler, {
    meta: { category: "account", resource: "namechange" },
  });

  app.get("/account/name/:name/availability", handlers.nameAvailabilityHandler, {
    meta: { category: "account", resource: "name-availability" },
  });

  app.post("/account/gift-code/validate", handlers.giftCodeValidationHandler, {
    meta: { category: "account", resource: "gift-code" },
  });

  app.get("/account/blocked-servers", handlers.blockedServersHandler, {
    meta: { category: "account", resource: "blocked-servers" },
  });

  return { app, handlers };
}

export const playerPlugin = definePlugin((app) => {
  const { handlers } = createPlayerApp({ app });
  return handlers;
});

function requireAccessToken(event) {
  const header = event.req?.headers?.get?.("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    throw new MinecraftToolkitError("Authorization header with Bearer token is required", { statusCode: 401 });
  }
  const token = header.slice(7).trim();
  if (!token) {
    throw new MinecraftToolkitError("Access token is required", { statusCode: 401 });
  }
  return token;
}
