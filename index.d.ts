import type { H3 } from "h3";
import type { Buffer } from "node:buffer";

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

export type FormattingMode = "inline" | "class";

export interface FormattingOptions {
  mode?: FormattingMode;
  classPrefix?: string;
  animationName?: string;
  obfuscatedSpeedMs?: number;
  escapeHtml?: boolean;
}

export interface FormattingColorMeta {
  name: string;
  classSuffix: string;
  hex: string;
}

export interface FormattingFormatMeta {
  name: string;
  classSuffix: string;
}

export interface FormattingMaps {
  colors: Record<string, FormattingColorMeta>;
  formats: Record<string, FormattingFormatMeta>;
}

export function toHTML(input: string, options?: FormattingOptions): string;
export function stripCodes(input: string): string;
export function generateCSS(options?: FormattingOptions): string;
export function hasCodes(input: string): boolean;
export function convertPrefix(input: string, direction?: "toSection" | "toAmpersand"): string;
export function getMaps(): FormattingMaps;

export function getSkinURL(profile: PlayerProfile | PlayerSkin): string | null;
export function getCapeURL(profile: PlayerProfile | PlayerSkin): string | null;
export function getSkinModel(profile: PlayerProfile | PlayerSkin): "default" | "slim";
export function extractTextureHash(url: string | null): string | null;

export type ServerEdition = "java" | "bedrock" | "auto";

export interface JavaServerStatusOptions {
  port?: number;
  timeoutMs?: number;
  protocolVersion?: number;
}

export interface BedrockServerStatusOptions {
  port?: number;
  timeoutMs?: number;
}

export interface ServerStatusOptions extends JavaServerStatusOptions {
  edition?: ServerEdition;
  type?: ServerEdition;
}

export interface JavaServerStatus {
  edition: "java";
  online: boolean;
  host: string;
  port: number;
  version: {
    name?: string | null;
    protocol?: number | null;
  } | null;
  players: {
    max?: number | null;
    online?: number | null;
    sample?: Array<{ name: string; id: string }>;
  } | null;
  motd: string | null;
  favicon: string | null;
  latencyMs: number | null;
  raw: Record<string, unknown>;
}

export interface BedrockServerStatus {
  edition: "bedrock";
  online: boolean;
  host: string;
  port: number;
  motd: string;
  version: {
    protocol: number;
    name: string;
  };
  players: {
    online: number;
    max: number;
  };
  serverId: string;
  map: string;
  gamemode: string;
  ipv4Port: number;
  ipv6Port: number | null;
  raw: string;
}

export type ServerStatus = JavaServerStatus | BedrockServerStatus;

export interface ServerIconResult {
  host: string;
  port: number;
  dataUri: string;
  base64: string;
  buffer: Buffer;
  byteLength: number;
}

export function fetchServerStatus(
  address: string,
  options?: ServerStatusOptions,
): Promise<ServerStatus>;
export function fetchJavaServerStatus(
  address: string,
  options?: JavaServerStatusOptions,
): Promise<JavaServerStatus>;
export function fetchBedrockServerStatus(
  address: string,
  options?: BedrockServerStatusOptions,
): Promise<BedrockServerStatus>;
export function fetchServerIcon(
  address: string,
  options?: JavaServerStatusOptions,
): Promise<ServerIconResult>;

export interface VotifierVoteOptions {
  host: string;
  port?: number;
  publicKey: string;
  serviceName: string;
  username: string;
  address: string;
  timestamp?: number | Date;
  timeoutMs?: number;
  token?: string;
  protocol?: "auto" | "v1" | "v2";
}

export interface VotifierVoteResult {
  acknowledged: boolean;
  version: string | null;
  protocol: "v1" | "v2";
}

export function sendVotifierVote(options: VotifierVoteOptions): Promise<VotifierVoteResult>;

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
