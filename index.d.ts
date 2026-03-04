import type { H3 } from "h3";

export interface SkinTexture {
  url: string;
  metadata?: {
    model?: "default" | "slim";
  };
}

export interface CapeTexture {
  url: string;
}

export interface PlayerProfile {
  id: string;
  name: string;
  profile: Record<string, unknown>;
  textures: Record<string, unknown>;
  skin: SkinTexture | null;
  cape: CapeTexture | null;
}

export interface PlayerSkin {
  id: string;
  name: string;
  skin: SkinTexture | null;
  cape: CapeTexture | null;
}

export interface PlayerSummary {
  id: string;
  name: string;
  skinUrl: string | null;
  capeUrl: string | null;
}

export interface BatchResult {
  username: string;
  profile?: PlayerProfile;
  error?: unknown;
}

export interface BatchOptions {
  delayMs?: number;
  signal?: AbortSignal;
}

export interface SkinMetadataResult {
  id: string;
  name: string;
  skin: SkinTexture | null;
  cape: CapeTexture | null;
  hasCape: boolean;
  dominantColor: string | null;
}

export function fetchPlayerProfile(username: string): Promise<PlayerProfile>;
export function fetchPlayerSkin(username: string): Promise<PlayerSkin>;
export function fetchPlayerUUID(username: string): Promise<{ id: string; name: string }>;
export function fetchUsernameByUUID(uuid: string): Promise<{ id: string; name: string }>;
export function fetchNameHistory(uuid: string): Promise<{ name: string; changedAt: Date | null }[]>;
export function fetchPlayers(usernames: string[], options?: BatchOptions): Promise<BatchResult[]>;
export function fetchPlayerSummary(username: string): Promise<PlayerSummary>;
export function playerExists(username: string): Promise<boolean>;
export function hasSkinChanged(profileA: PlayerProfile, profileB: PlayerProfile): boolean;
export function fetchSkinMetadata(
  username: string,
  options?: {
    dominantColor?: boolean;
    sampleRegion?: { x?: number; y?: number; width?: number; height?: number };
  },
): Promise<SkinMetadataResult>;
export function fetchSkinDominantColor(
  url: string,
  region?: { x?: number; y?: number; width?: number; height?: number },
): Promise<string | null>;
export function resolvePlayer(input: string): Promise<PlayerSkin>;

export function isValidUsername(username: string): boolean;
export function isUUID(value: string): boolean;
export function normalizeUUID(uuid: string): string;
export function uuidWithDashes(uuid: string): string;
export function uuidWithoutDashes(uuid: string): string;

export function getSkinURL(profile: PlayerProfile | PlayerSkin): string | null;
export function getCapeURL(profile: PlayerProfile | PlayerSkin): string | null;
export function getSkinModel(profile: PlayerProfile | PlayerSkin): "default" | "slim";
export function extractTextureHash(url: string | null): string | null;

export interface PlayerHandlers {
  profileHandler: any;
  skinHandler: any;
  summaryHandler: any;
  uuidHandler: any;
  resolverHandler: any;
}

export function createPlayerHandlers(): PlayerHandlers;
export function createPlayerApp(options?: { app?: ConstructorParameters<typeof H3>[0] }): {
  app: H3;
  handlers: PlayerHandlers;
};
export const playerPlugin: (app: H3) => PlayerHandlers;

export function fetchNameChangeInfo(accessToken: string): Promise<any>;
export function checkNameAvailability(name: string, accessToken: string): Promise<any>;
export function validateGiftCode(code: string, accessToken: string): Promise<boolean>;
export function fetchBlockedServers(): Promise<string[]>;
