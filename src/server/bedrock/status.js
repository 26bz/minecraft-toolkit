import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { DEFAULT_BEDROCK_PORT, RAKNET_MAGIC } from "../../constants.js";
import { MinecraftToolkitError } from "../../errors.js";
import { normalizeAddress } from "../../utils/validation.js";
import { resolveAddress } from "../../utils/network.js";
import { resolveTimeout, makeError } from "../shared.js";

export async function fetchBedrockServerStatus(address, options = {}) {
  const normalized = normalizeAddress(address);
  const { host, port } = resolveAddress(normalized, options.port, DEFAULT_BEDROCK_PORT);
  const timeoutMs = resolveTimeout(options.timeoutMs);

  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    let settled = false;

    const timestamp = BigInt(Date.now());
    const clientGuid = randomBytes(8);
    const pingPacket = buildBedrockPingPacket(timestamp, clientGuid);

    const timeout = setTimeout(() => {
      rejectOnce(
        new MinecraftToolkitError(`Timed out while querying Bedrock server ${host}:${port}`, {
          statusCode: 504,
        }),
      );
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.close();
    }

    function resolveOnce(value) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }

    function rejectOnce(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        error instanceof MinecraftToolkitError
          ? error
          : makeError(`Unable to query Bedrock server ${host}:${port}`, error),
      );
    }

    socket.once("error", (error) => {
      rejectOnce(makeError(`Unable to reach Bedrock server ${host}:${port}`, error));
    });

    socket.on("message", (message) => {
      try {
        const status = parseBedrockStatus(message, host, port);
        resolveOnce(status);
      } catch (error) {
        rejectOnce(
          error instanceof MinecraftToolkitError
            ? error
            : makeError("Invalid Bedrock response", error),
        );
      }
    });

    socket.send(pingPacket, port, host, (error) => {
      if (error) {
        rejectOnce(makeError(`Failed to send Bedrock ping to ${host}:${port}`, error));
      }
    });
  });
}

function buildBedrockPingPacket(timestamp, clientGuid) {
  const buffer = Buffer.alloc(1 + 8 + 16 + 8);
  let offset = 0;
  buffer.writeUInt8(0x01, offset);
  offset += 1;
  buffer.writeBigInt64BE(timestamp, offset);
  offset += 8;
  RAKNET_MAGIC.copy(buffer, offset);
  offset += RAKNET_MAGIC.length;
  clientGuid.copy(buffer, offset);
  return buffer;
}

function parseBedrockStatus(message, host, port) {
  if (message.length < 35) {
    throw new MinecraftToolkitError("Bedrock response too short");
  }
  const packetId = message.readUInt8(0);
  if (packetId !== 0x1c) {
    throw new MinecraftToolkitError(`Unexpected Bedrock packet id ${packetId}`);
  }
  const magic = message.subarray(17, 33);
  if (!magic.equals(RAKNET_MAGIC)) {
    throw new MinecraftToolkitError("Invalid RakNet magic");
  }
  const stringLength = message.readUInt16BE(33);
  const totalLength = 35 + stringLength;
  if (message.length < totalLength) {
    throw new MinecraftToolkitError("Bedrock payload truncated");
  }
  const data = message.subarray(35, totalLength).toString("utf8");
  const parts = data.split(";");
  if (parts[0] !== "MCPE") {
    throw new MinecraftToolkitError("Unexpected Bedrock edition identifier");
  }

  const protocol = Number.parseInt(parts[2] ?? "0", 10) || 0;
  const versionName = parts[3] ?? "";
  const onlinePlayers = Number.parseInt(parts[4] ?? "0", 10) || 0;
  const maxPlayers = Number.parseInt(parts[5] ?? "0", 10) || 0;
  const ipv4Port = Number.parseInt(parts[9] ?? `${port}`, 10) || port;
  const ipv6Port = parts[10] ? Number.parseInt(parts[10], 10) || null : null;

  return {
    edition: "bedrock",
    online: true,
    host,
    port,
    motd: parts[1] ?? "",
    version: {
      protocol,
      name: versionName,
    },
    players: {
      online: onlinePlayers,
      max: maxPlayers,
    },
    serverId: parts[6] ?? "",
    map: parts[7] ?? "",
    gamemode: parts[8] ?? "",
    ipv4Port,
    ipv6Port,
    raw: data,
  };
}
