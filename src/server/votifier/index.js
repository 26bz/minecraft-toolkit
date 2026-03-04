import { Socket } from "node:net";
import {
  createPublicKey,
  publicEncrypt,
  constants as cryptoConstants,
  createHmac,
  randomBytes,
} from "node:crypto";
import { DEFAULT_TIMEOUT_MS, DEFAULT_VOTIFIER_PORT } from "../../constants.js";
import { MinecraftToolkitError } from "../../errors.js";
import { normalizeAddress, normalizeUsername } from "../../utils/validation.js";
import { resolveTimeout, makeError } from "../shared.js";

const HANDSHAKE_PREFIX = "VOTIFIER";

const PROTOCOL_V1 = "v1";
const PROTOCOL_V2 = "v2";

export async function sendVotifierVote(options = {}) {
  const {
    host,
    port = DEFAULT_VOTIFIER_PORT,
    publicKey,
    serviceName,
    username,
    address,
    timestamp = Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    token,
    protocol = "auto",
  } = options;

  if (!host) {
    throw new MinecraftToolkitError("Votifier host is required", { statusCode: 400 });
  }

  if (!serviceName || typeof serviceName !== "string") {
    throw new MinecraftToolkitError("Service name is required", { statusCode: 400 });
  }
  if (!username || typeof username !== "string") {
    throw new MinecraftToolkitError("Username is required", { statusCode: 400 });
  }
  if (!address || typeof address !== "string") {
    throw new MinecraftToolkitError("Voter IP address is required", { statusCode: 400 });
  }

  const normalizedHost = normalizeAddress(host);
  const normalizedUsername = normalizeUsername(username);
  const sanitizedService = serviceName.trim();
  const sanitizedAddress = address.trim();
  if (!sanitizedService) {
    throw new MinecraftToolkitError("Service name cannot be empty", { statusCode: 400 });
  }
  if (!sanitizedAddress) {
    throw new MinecraftToolkitError("Voter IP address cannot be empty", { statusCode: 400 });
  }

  const resolvedPort = Number.isInteger(port) ? port : DEFAULT_VOTIFIER_PORT;
  const resolvedTimeout = resolveTimeout(timeoutMs);
  const normalizedProtocol = normalizeProtocol(protocol);
  const hasPublicKey = typeof publicKey === "string" && publicKey.trim().length > 0;
  const hasToken = typeof token === "string" && token.trim().length > 0;

  if (normalizedProtocol === PROTOCOL_V1 && !hasPublicKey) {
    throw new MinecraftToolkitError("Votifier public key is required for protocol v1", {
      statusCode: 400,
    });
  }
  if (normalizedProtocol === PROTOCOL_V2 && !hasToken) {
    throw new MinecraftToolkitError("Votifier token is required for protocol v2", {
      statusCode: 400,
    });
  }
  if (normalizedProtocol === "auto" && !hasPublicKey && !hasToken) {
    throw new MinecraftToolkitError("Either a public key or token must be provided", {
      statusCode: 400,
    });
  }

  const unixSeconds =
    typeof timestamp === "number"
      ? Math.floor(timestamp / 1000)
      : Math.floor(timestamp.getTime() / 1000);
  const voteString = buildVotePayload({
    serviceName: sanitizedService,
    username: normalizedUsername,
    address: sanitizedAddress,
    timestamp: unixSeconds,
  });
  const voteBufferV1 = hasPublicKey
    ? encryptVotePayload(Buffer.from(voteString, "utf8"), publicKey)
    : null;

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setNoDelay?.(true);

    let settled = false;
    let handshakeBuffer = Buffer.alloc(0);
    let handshakeReceived = false;
    let reportedVersion = null;
    let voteDispatched = false;
    let selectedProtocol = normalizedProtocol === "auto" ? null : normalizedProtocol;

    function cleanup() {
      socket.removeAllListeners();
      socket.destroy();
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
          : makeError(`Unable to send Votifier vote to ${normalizedHost}:${resolvedPort}`, error),
      );
    }

    socket.setTimeout(resolvedTimeout, () => {
      rejectOnce(
        new MinecraftToolkitError(
          `Timed out while sending vote to ${normalizedHost}:${resolvedPort}`,
          {
            statusCode: 504,
          },
        ),
      );
    });

    socket.once("error", (error) => {
      rejectOnce(makeError(`Unable to connect to ${normalizedHost}:${resolvedPort}`, error));
    });

    socket.on("data", (chunk) => {
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      const handshakeText = handshakeBuffer.toString("utf8").trim();
      if (!handshakeText.startsWith(HANDSHAKE_PREFIX)) {
        return;
      }
      handshakeReceived = true;

      const { version, challenge } = parseHandshake(handshakeText);
      reportedVersion = version;

      if (!selectedProtocol || selectedProtocol === "auto") {
        if (version?.startsWith("2") && hasToken) {
          selectedProtocol = PROTOCOL_V2;
        } else if (hasPublicKey) {
          selectedProtocol = PROTOCOL_V1;
        } else if (hasToken) {
          selectedProtocol = PROTOCOL_V2;
        }
      }

      if (selectedProtocol === PROTOCOL_V1 && !hasPublicKey) {
        rejectOnce(
          new MinecraftToolkitError("Server expects Votifier v1 but no public key was provided", {
            statusCode: 400,
          }),
        );
        return;
      }
      if (selectedProtocol === PROTOCOL_V2 && !hasToken) {
        rejectOnce(
          new MinecraftToolkitError("Server expects Votifier v2 but no token was provided", {
            statusCode: 400,
          }),
        );
        return;
      }

      sendVote(challenge);
    });

    socket.on("close", () => {
      if (settled) {
        return;
      }
      if (!handshakeReceived || !voteDispatched) {
        rejectOnce(
          new MinecraftToolkitError("Connection closed before Votifier vote was sent", {
            statusCode: 502,
          }),
        );
        return;
      }
      resolveOnce({
        acknowledged: true,
        version: reportedVersion,
        protocol: selectedProtocol ?? PROTOCOL_V1,
      });
    });

    socket.connect(resolvedPort, normalizedHost);

    function sendVote(challengeSegment) {
      socket.removeAllListeners("data");
      try {
        voteDispatched = true;
        if (selectedProtocol === PROTOCOL_V2) {
          const payload = buildV2Payload({
            serviceName: sanitizedService,
            username: normalizedUsername,
            address: sanitizedAddress,
            timestamp: unixSeconds,
            token,
            challengeSegment,
          });
          socket.write(payload, (writeError) => {
            if (writeError) {
              rejectOnce(makeError("Failed to deliver Votifier v2 payload", writeError));
              return;
            }
            socket.once("data", (response) => {
              try {
                const parsed = JSON.parse(response.toString("utf8"));
                if (parsed?.status === "error") {
                  rejectOnce(
                    new MinecraftToolkitError(parsed.errorMessage || "Votifier v2 error", {
                      cause: parsed,
                      statusCode: 502,
                    }),
                  );
                } else {
                  socket.end();
                }
              } catch (parseError) {
                rejectOnce(makeError("Invalid Votifier v2 response", parseError));
              }
            });
          });
          return;
        }

        socket.write(voteBufferV1, (writeError) => {
          if (writeError) {
            rejectOnce(makeError("Failed to deliver Votifier payload", writeError));
            return;
          }
          socket.end();
        });
      } catch (sendError) {
        rejectOnce(makeError("Failed to send Votifier payload", sendError));
      }
    }
  });
}

function buildVotePayload({ serviceName, username, address, timestamp }) {
  return `VOTE\n${serviceName}\n${username}\n${address}\n${timestamp}\n`;
}

function buildV2Payload({ serviceName, username, address, timestamp, token, challengeSegment }) {
  const normalizedChallenge = challengeSegment?.trim() || randomBytes(16).toString("hex");
  const vote = {
    serviceName,
    username,
    address,
    timestamp,
    challenge: normalizedChallenge,
  };
  const payload = JSON.stringify(vote);
  const signature = createHmac("sha256", token).update(payload).digest("base64");
  const message = JSON.stringify({ payload, signature });
  const buffer = Buffer.alloc(4 + Buffer.byteLength(message));
  buffer.writeUInt16BE(0x733a, 0);
  buffer.writeUInt16BE(Buffer.byteLength(message), 2);
  buffer.write(message, 4, "utf8");
  return buffer;
}

function encryptVotePayload(payload, publicKey) {
  let key;
  try {
    key = createPublicKey(
      publicKey.includes("BEGIN")
        ? publicKey
        : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`,
    );
  } catch (error) {
    throw new MinecraftToolkitError("Invalid Votifier public key", {
      statusCode: 400,
      cause: error,
    });
  }

  try {
    return publicEncrypt(
      {
        key,
        padding: cryptoConstants.RSA_PKCS1_PADDING,
      },
      payload,
    );
  } catch (error) {
    throw new MinecraftToolkitError("Failed to encrypt Votifier payload", {
      statusCode: 400,
      cause: error,
    });
  }
}

function parseHandshake(text) {
  const parts = text.split(" ");
  return {
    version: parts[1] ?? null,
    challenge: parts[2] ?? null,
  };
}

function normalizeProtocol(protocol) {
  return protocol === PROTOCOL_V1 || protocol === PROTOCOL_V2 || protocol === "auto"
    ? protocol
    : "auto";
}
