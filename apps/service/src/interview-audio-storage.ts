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

export function createConfiguredInterviewAudioStorage(): InterviewAudioStorage {
  return new LocalInterviewAudioStorage({
    bucketName: process.env.INTERVIEW_AUDIO_BUCKET_NAME ?? "education-researcher-local",
    rootDirectory:
      process.env.INTERVIEW_AUDIO_STORAGE_DIR ??
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
  return storageKey
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(path.sep);
}
