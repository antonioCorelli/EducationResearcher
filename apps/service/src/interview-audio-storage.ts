import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SaveInterviewAudioObjectInput {
  readonly storageKey: string;
  readonly content: Uint8Array;
  readonly mimeType: string;
}

export interface InterviewAudioStorage {
  save(input: SaveInterviewAudioObjectInput): Promise<{
    readonly storageUri: string;
  }>;
  read(storageUri: string): Promise<{
    readonly content: Uint8Array;
  }>;
}

export type InterviewAudioStorageBackend = "local" | "s3";

export interface ConfiguredInterviewAudioStorageOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly s3Client?: S3ClientLike;
}

interface S3ClientLike {
  send(command: PutObjectCommand | GetObjectCommand): Promise<{
    readonly Body?: unknown;
  }>;
}

export function createConfiguredInterviewAudioStorage(
  options: ConfiguredInterviewAudioStorageOptions = {}
): InterviewAudioStorage {
  const env = options.env ?? process.env;
  const backend = parseStorageBackend(
    env.INTERVIEW_AUDIO_STORAGE_BACKEND ?? (env.NODE_ENV === "production" ? "s3" : "local")
  );

  if (backend === "s3") {
    return new S3InterviewAudioStorage({
      bucketName: requireS3BucketName(env),
      keyPrefix: env.INTERVIEW_AUDIO_STORAGE_PREFIX ?? "audio",
      s3Client: options.s3Client
    });
  }

  return new LocalInterviewAudioStorage({
    bucketName: env.INTERVIEW_AUDIO_BUCKET_NAME ?? env.ARTIFACT_STORAGE_BUCKET_NAME ?? "education-researcher-local",
    rootDirectory:
      env.INTERVIEW_AUDIO_STORAGE_DIR ??
      fileURLToPath(new URL("../../../.local/interview-audio", import.meta.url))
  });
}

export class LocalInterviewAudioStorage implements InterviewAudioStorage {
  constructor(
    private readonly options: {
      readonly bucketName: string;
      readonly rootDirectory: string;
    }
  ) {}

  async save(input: SaveInterviewAudioObjectInput) {
    const normalizedStorageKey = normalizeStorageKey(input.storageKey);
    const absolutePath = this.resolveStorageKey(normalizedStorageKey);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.content);

    return {
      storageUri: `s3://${this.options.bucketName}/${normalizedStorageKey.replaceAll(path.sep, "/")}`
    };
  }

  async read(storageUri: string) {
    const storageUrl = parseS3StorageUri(storageUri);

    if (storageUrl.bucketName !== this.options.bucketName) {
      throw new Error("Interview audio storage URI does not belong to the configured local bucket.");
    }

    return {
      content: await readFile(this.resolveStorageKey(normalizeStorageKey(storageUrl.storageKey)))
    };
  }

  private resolveStorageKey(storageKey: string) {
    const absolutePath = path.resolve(this.options.rootDirectory, storageKey);
    const rootPath = path.resolve(this.options.rootDirectory);

    if (!absolutePath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error("Interview audio storage key resolved outside the configured storage directory.");
    }

    return absolutePath;
  }
}

export class S3InterviewAudioStorage implements InterviewAudioStorage {
  private readonly bucketName: string;
  private readonly keyPrefix: string;
  private readonly s3Client: S3ClientLike;

  constructor(options: {
    readonly bucketName: string;
    readonly keyPrefix?: string;
    readonly s3Client?: S3ClientLike;
  }) {
    this.bucketName = requireNonEmptyText(options.bucketName, "S3 bucket name");
    this.keyPrefix = normalizeStorageKey(options.keyPrefix ?? "audio");
    this.s3Client = options.s3Client ?? new S3Client({});
  }

  async save(input: SaveInterviewAudioObjectInput) {
    const key = this.toS3ObjectKey(input.storageKey);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: input.content,
        ContentType: input.mimeType,
        ServerSideEncryption: "AES256"
      })
    );

    return {
      storageUri: `s3://${this.bucketName}/${key}`
    };
  }

  async read(storageUri: string) {
    const storageUrl = parseS3StorageUri(storageUri);

    if (storageUrl.bucketName !== this.bucketName) {
      throw new Error("Interview audio storage URI does not belong to the configured S3 bucket.");
    }

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: storageUrl.storageKey
      })
    );

    return {
      content: await collectBodyBytes(response.Body)
    };
  }

  private toS3ObjectKey(storageKey: string) {
    return [this.keyPrefix, normalizeStorageKey(storageKey)].filter(Boolean).join("/");
  }
}

function parseS3StorageUri(storageUri: string) {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(storageUri);

  if (!match) {
    throw new Error("Interview audio storage URI is invalid.");
  }

  return {
    bucketName: match[1],
    storageKey: match[2]
  };
}

function normalizeStorageKey(storageKey: string) {
  const normalizedStorageKey = storageKey
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (normalizedStorageKey.length === 0 || normalizedStorageKey.some((part) => part === "." || part === "..")) {
    throw new Error("Interview audio storage key is invalid.");
  }

  return normalizedStorageKey.join("/");
}

function parseStorageBackend(value: string): InterviewAudioStorageBackend {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "local" || normalizedValue === "s3") {
    return normalizedValue;
  }

  throw new Error("INTERVIEW_AUDIO_STORAGE_BACKEND must be either local or s3.");
}

function requireS3BucketName(env: NodeJS.ProcessEnv) {
  const bucketName = env.INTERVIEW_AUDIO_BUCKET_NAME ?? env.ARTIFACT_STORAGE_BUCKET_NAME;

  return requireNonEmptyText(
    bucketName,
    "ARTIFACT_STORAGE_BUCKET_NAME or INTERVIEW_AUDIO_BUCKET_NAME is required when INTERVIEW_AUDIO_STORAGE_BACKEND=s3"
  );
}

function requireNonEmptyText(value: string | undefined, label: string) {
  if (!value?.trim()) {
    throw new Error(`${label}.`);
  }

  return value.trim();
}

async function collectBodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    return body;
  }

  if (hasTransformToByteArray(body)) {
    return body.transformToByteArray();
  }

  if (isAsyncIterable(body)) {
    const chunks: Uint8Array[] = [];

    for await (const chunk of body) {
      chunks.push(toUint8Array(chunk));
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  throw new Error("Interview audio object body could not be read from S3.");
}

function hasTransformToByteArray(value: unknown): value is { transformToByteArray(): Promise<Uint8Array> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "transformToByteArray" in value &&
    typeof (value as { transformToByteArray?: unknown }).transformToByteArray === "function"
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function toUint8Array(value: unknown) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (typeof value === "string") {
    return Buffer.from(value);
  }

  throw new Error("Interview audio object stream contained an unsupported chunk.");
}
