import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  LocalInterviewAudioStorage,
  S3InterviewAudioStorage,
  createConfiguredInterviewAudioStorage
} from "./interview-audio-storage.js";

class FakeS3Client {
  readonly commands: Array<GetObjectCommand | PutObjectCommand> = [];

  async send(command: GetObjectCommand | PutObjectCommand) {
    this.commands.push(command);

    if (command instanceof GetObjectCommand) {
      return {
        Body: Readable.from([Buffer.from("stored-audio")])
      };
    }

    return {};
  }
}

describe("configured interview audio storage", () => {
  it("keeps local filesystem storage as the non-production default", () => {
    const storage = createConfiguredInterviewAudioStorage({
      env: {
        NODE_ENV: "development",
        INTERVIEW_AUDIO_BUCKET_NAME: "education-researcher-local"
      }
    });

    expect(storage).toBeInstanceOf(LocalInterviewAudioStorage);
  });

  it("uses S3 storage in production and requires a configured artifact bucket", () => {
    const s3Client = new FakeS3Client();
    const storage = createConfiguredInterviewAudioStorage({
      env: {
        NODE_ENV: "production",
        ARTIFACT_STORAGE_BUCKET_NAME: "education-researcher-prod-artifacts-077317248751"
      },
      s3Client
    });

    expect(storage).toBeInstanceOf(S3InterviewAudioStorage);
    expect(() =>
      createConfiguredInterviewAudioStorage({
        env: {
          NODE_ENV: "production"
        }
      })
    ).toThrow("ARTIFACT_STORAGE_BUCKET_NAME or INTERVIEW_AUDIO_BUCKET_NAME is required");
  });
});

describe("S3 interview audio storage", () => {
  it("writes encrypted audio objects under the configured audio prefix", async () => {
    const s3Client = new FakeS3Client();
    const storage = new S3InterviewAudioStorage({
      bucketName: "education-researcher-prod-artifacts-077317248751",
      keyPrefix: "audio",
      s3Client
    });

    const result = await storage.save({
      storageKey: "study_001/slot_001/run_001/interview-audio/session_001/audio_001.webm",
      content: Buffer.from("fixture-audio"),
      mimeType: "audio/webm"
    });

    expect(result).toEqual({
      storageUri:
        "s3://education-researcher-prod-artifacts-077317248751/audio/study_001/slot_001/run_001/interview-audio/session_001/audio_001.webm"
    });
    expect(s3Client.commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(s3Client.commands[0]?.input).toMatchObject({
      Bucket: "education-researcher-prod-artifacts-077317248751",
      Key: "audio/study_001/slot_001/run_001/interview-audio/session_001/audio_001.webm",
      ContentType: "audio/webm",
      ServerSideEncryption: "AES256"
    });
  });

  it("reads audio objects only from the configured bucket", async () => {
    const s3Client = new FakeS3Client();
    const storage = new S3InterviewAudioStorage({
      bucketName: "education-researcher-prod-artifacts-077317248751",
      s3Client
    });

    const result = await storage.read(
      "s3://education-researcher-prod-artifacts-077317248751/audio/study_001/run_001/audio_001.webm"
    );

    expect(Buffer.from(result.content).toString("utf8")).toBe("stored-audio");
    expect(s3Client.commands[0]).toBeInstanceOf(GetObjectCommand);
    expect(s3Client.commands[0]?.input).toMatchObject({
      Bucket: "education-researcher-prod-artifacts-077317248751",
      Key: "audio/study_001/run_001/audio_001.webm"
    });
    await expect(storage.read("s3://other-bucket/audio/study_001/run_001/audio_001.webm")).rejects.toThrow(
      "does not belong to the configured S3 bucket"
    );
  });
});
