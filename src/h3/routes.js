import { H3, defineHandler, definePlugin } from "h3";
import { MinecraftToolkitError } from "../errors.js";
import {
  fetchPlayerProfile,
  fetchPlayerSkin,
  fetchPlayerSummary,
  fetchPlayerUUID,
} from "../player/profile/index.js";
import { resolvePlayer } from "../player/resolve.js";

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

  return {
    profileHandler,
    skinHandler,
    summaryHandler,
    uuidHandler,
    resolverHandler,
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

  return { app, handlers };
}

export const playerPlugin = definePlugin((app) => {
  const { handlers } = createPlayerApp({ app });
  return handlers;
});
