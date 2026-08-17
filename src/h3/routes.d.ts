import type { H3 } from "h3";

export interface PlayerHandlers {
  profileHandler: import("h3").EventHandler;
  skinHandler: import("h3").EventHandler;
  summaryHandler: import("h3").EventHandler;
  uuidHandler: import("h3").EventHandler;
  resolverHandler: import("h3").EventHandler;
  existsHandler: import("h3").EventHandler;
  batchHandler: import("h3").EventHandler;
  nameChangeInfoHandler: import("h3").EventHandler;
  nameAvailabilityHandler: import("h3").EventHandler;
  giftCodeValidationHandler: import("h3").EventHandler;
  blockedServersHandler: import("h3").EventHandler;
  serverStatusHandler: import("h3").EventHandler;
  serverIconHandler: import("h3").EventHandler;
}

export function createPlayerHandlers(): PlayerHandlers;
export function createPlayerApp(options?: { app?: ConstructorParameters<typeof H3>[0] }): {
  app: H3;
  handlers: PlayerHandlers;
};
export const playerPlugin: (app: H3) => PlayerHandlers;
