import { createHmac, timingSafeEqual } from "node:crypto";
import type { InterviewAudioAsset } from "./runs.js";

export interface SignedAudioUrlInput {
  readonly asset: Pick<InterviewAudioAsset, "id" | "mimeType" | "storageUri">;
  readonly baseUrl?: string;
  readonly expiresAt: Date;
  readonly signingSecret?: string;
}

export interface VerifySignedAudioUrlInput {
  readonly assetId?: unknown;
  readonly expiresAt?: unknown;
  readonly mimeType?: unknown;
  readonly signature?: unknown;
  readonly storageUri?: unknown;
  readonly signingSecret?: string;
  readonly now?: Date;
}

export function createServiceSignedAudioUrl(input: SignedAudioUrlInput) {
  const baseUrl = normalizeLocalPlaybackBaseUrl(input.baseUrl ?? process.env.SERVICE_PUBLIC_BASE_URL ?? "http://127.0.0.1:4000");
  const expiresAt = input.expiresAt.toISOString();
  const mimeType = input.asset.mimeType ?? "application/octet-stream";
  const url = new URL("/audio/interview", baseUrl);

  url.searchParams.set("assetId", input.asset.id);
  url.searchParams.set("expiresAt", expiresAt);
  url.searchParams.set("mimeType", mimeType);
  url.searchParams.set("storageUri", input.asset.storageUri);
  url.searchParams.set(
    "signature",
    signAudioUrlPayload(
      {
        assetId: input.asset.id,
        expiresAt,
        mimeType,
        storageUri: input.asset.storageUri
      },
      input.signingSecret
    )
  );

  return url.toString();
}

export function verifySignedAudioUrl(input: VerifySignedAudioUrlInput) {
  const assetId = parseSignedAudioText(input.assetId, "Audio asset ID");
  const expiresAt = parseSignedAudioText(input.expiresAt, "Audio link expiry");
  const mimeType = parseSignedAudioText(input.mimeType, "Audio MIME type");
  const signature = parseSignedAudioText(input.signature, "Audio link signature");
  const storageUri = parseSignedAudioText(input.storageUri, "Audio storage URI");

  if (Number.isNaN(Date.parse(expiresAt)) || new Date(expiresAt).getTime() <= (input.now ?? new Date()).getTime()) {
    throw new SignedAudioUrlError("Audio link has expired.");
  }

  const expectedSignature = signAudioUrlPayload({ assetId, expiresAt, mimeType, storageUri }, input.signingSecret);

  if (!safeEqual(signature, expectedSignature)) {
    throw new SignedAudioUrlError("Audio link is invalid.");
  }

  return {
    assetId,
    expiresAt,
    mimeType,
    storageUri
  };
}

export class SignedAudioUrlError extends Error {
  readonly statusCode = 403;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "SignedAudioUrlError";
  }
}

function signAudioUrlPayload(
  input: {
    readonly assetId: string;
    readonly expiresAt: string;
    readonly mimeType: string;
    readonly storageUri: string;
  },
  signingSecret = getConfiguredAudioSigningSecret()
) {
  return createHmac("sha256", signingSecret)
    .update(JSON.stringify(input))
    .digest("base64url");
}

function getConfiguredAudioSigningSecret() {
  return process.env.AUDIO_LINK_SIGNING_SECRET ?? process.env.PARTICIPANT_ACCESS_TOKEN_SECRET ?? "local-audio-link-secret";
}

function parseSignedAudioText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new SignedAudioUrlError(`${label} is required.`);
  }

  return value.trim();
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeLocalPlaybackBaseUrl(baseUrl: string) {
  const url = new URL(baseUrl);

  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }

  return url.toString();
}
