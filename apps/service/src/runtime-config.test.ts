import { afterEach, describe, expect, it, vi } from "vitest";
import { validateProductionRuntimeConfig } from "./runtime-config.js";

const requiredProductionConfig = {
  NODE_ENV: "production",
  AWS_REGION: "us-east-1",
  EDUCATION_RESEARCHER_ENV: "prod",
  SERVICE_HOST: "0.0.0.0",
  SERVICE_PUBLIC_BASE_URL: "https://api.voxaria.io",
  CORS_ORIGIN: "https://voxaria.io,https://www.voxaria.io",
  COGNITO_USER_POOL_ID: "us-east-1_jTLroPp4Z",
  COGNITO_CLIENT_ID: "51gd0to7l28c5vi7veh0a7quu1",
  STUDY_SHELL_STORE: "dynamodb",
  PARTICIPANT_SLOT_STORE: "dynamodb",
  CONSENT_VERSION_STORE: "dynamodb",
  SURVEY_VERSION_STORE: "dynamodb",
  OBJECTIVE_VERSION_STORE: "dynamodb",
  RUN_LIFECYCLE_STORE: "dynamodb",
  OPERATIONS_STORE: "dynamodb",
  PARTICIPANT_ACCESS_BASE_URL: "https://voxaria.io",
  PARTICIPANT_ACCESS_TOKEN_SECRET: "participant-secret",
  AUDIO_LINK_SIGNING_SECRET: "audio-secret",
  OPENAI_API_KEY: "openai-secret",
  INTERVIEW_AUDIO_STORAGE_BACKEND: "s3",
  ARTIFACT_STORAGE_BUCKET_NAME: "education-researcher-prod-artifacts-077317248751"
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production runtime config validation", () => {
  it("does not require production configuration outside production", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(() => validateProductionRuntimeConfig()).not.toThrow();
  });

  it("accepts the required production configuration", () => {
    for (const [name, value] of Object.entries(requiredProductionConfig)) {
      vi.stubEnv(name, value);
    }

    expect(() => validateProductionRuntimeConfig()).not.toThrow();
  });

  it("fails closed when required production secrets are missing", () => {
    for (const [name, value] of Object.entries(requiredProductionConfig)) {
      vi.stubEnv(name, value);
    }

    vi.stubEnv("PARTICIPANT_ACCESS_TOKEN_SECRET", "");
    vi.stubEnv("AUDIO_LINK_SIGNING_SECRET", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(() => validateProductionRuntimeConfig()).toThrow(
      "Invalid production service configuration: missing PARTICIPANT_ACCESS_TOKEN_SECRET, AUDIO_LINK_SIGNING_SECRET, OPENAI_API_KEY."
    );
  });

  it("rejects unexpected production origins", () => {
    for (const [name, value] of Object.entries(requiredProductionConfig)) {
      vi.stubEnv(name, value);
    }

    vi.stubEnv("CORS_ORIGIN", "https://voxaria.io,https://evil.example");

    expect(() => validateProductionRuntimeConfig()).toThrow("invalid CORS_ORIGIN");
  });

  it("requires S3-backed artifact storage in production", () => {
    for (const [name, value] of Object.entries(requiredProductionConfig)) {
      vi.stubEnv(name, value);
    }

    vi.stubEnv("INTERVIEW_AUDIO_STORAGE_BACKEND", "local");
    vi.stubEnv("ARTIFACT_STORAGE_BUCKET_NAME", "");

    expect(() => validateProductionRuntimeConfig()).toThrow(
      "Invalid production service configuration: missing ARTIFACT_STORAGE_BUCKET_NAME; invalid INTERVIEW_AUDIO_STORAGE_BACKEND."
    );
  });

  it("accepts a boolean new-voice flag and rejects deployment typos", () => {
    for (const [name, value] of Object.entries(requiredProductionConfig)) {
      vi.stubEnv(name, value);
    }

    vi.stubEnv("NEW_VOICE_MODEL_ENABLED", "true");
    expect(() => validateProductionRuntimeConfig()).not.toThrow();

    vi.stubEnv("NEW_VOICE_MODEL_ENABLED", "false");
    expect(() => validateProductionRuntimeConfig()).not.toThrow();

    vi.stubEnv("NEW_VOICE_MODEL_ENABLED", "enable");
    expect(() => validateProductionRuntimeConfig()).toThrow("invalid NEW_VOICE_MODEL_ENABLED");
  });
});
