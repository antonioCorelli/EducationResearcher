import { describe, expect, it } from "vitest";
import {
  AiProviderError,
  StructuredOutputValidationError,
  executeStructuredAiCall,
  isRetryableAiProviderErrorCategory,
  type StructuredAiProvider
} from "./ai-provider.js";

describe("structured AI provider executor", () => {
  it("returns validated output with model metadata", async () => {
    const provider: StructuredAiProvider = {
      async completeStructured() {
        return {
          output: { value: "ok" },
          metadata: {
            modelName: "fake-model",
            modelVersion: "local-1",
            serviceRequestId: "req_001",
            promptVersion: "prompt-v1"
          }
        };
      }
    };

    await expect(
      executeStructuredAiCall({
        provider,
        request: { passKind: "scoring", promptVersion: "prompt-v1", input: {} },
        validate: (output, metadata) => ({ output, metadata })
      })
    ).resolves.toMatchObject({
      output: { value: "ok" },
      metadata: {
        modelName: "fake-model",
        modelVersion: "local-1",
        serviceRequestId: "req_001"
      }
    });
  });

  it("maps malformed structured output to a non-retryable safe category", async () => {
    const provider: StructuredAiProvider = {
      async completeStructured() {
        return {
          output: { value: "bad" },
          metadata: {
            modelName: "fake-model",
            modelVersion: "local-1",
            serviceRequestId: "req_001",
            promptVersion: "prompt-v1"
          }
        };
      }
    };

    await expect(
      executeStructuredAiCall({
        provider,
        request: { passKind: "scoring", promptVersion: "prompt-v1", input: {} },
        validate: () => {
          throw new StructuredOutputValidationError("Malformed response.");
        }
      })
    ).rejects.toMatchObject({
      safeCategory: "invalid_ai_output",
      retryable: false
    });
  });

  it("retries safe retryable provider categories", async () => {
    let attempts = 0;
    const provider: StructuredAiProvider = {
      async completeStructured() {
        attempts += 1;

        if (attempts === 1) {
          throw new AiProviderError({ safeCategory: "timeout" });
        }

        return {
          output: { value: "ok" },
          metadata: {
            modelName: "fake-model",
            modelVersion: "local-1",
            serviceRequestId: "req_retry",
            promptVersion: "prompt-v1"
          }
        };
      }
    };

    const result = await executeStructuredAiCall({
      provider,
      request: { passKind: "scoring", promptVersion: "prompt-v1", input: {} },
      validate: (output) => output
    });

    expect(result).toEqual({ value: "ok" });
    expect(attempts).toBe(2);
  });

  it("does not retry non-retryable provider categories", async () => {
    let attempts = 0;
    const provider: StructuredAiProvider = {
      async completeStructured() {
        attempts += 1;
        throw new AiProviderError({ safeCategory: "auth_error" });
      }
    };

    await expect(
      executeStructuredAiCall({
        provider,
        request: { passKind: "scoring", promptVersion: "prompt-v1", input: {} },
        validate: (output) => output
      })
    ).rejects.toMatchObject({
      safeCategory: "auth_error",
      retryable: false
    });
    expect(attempts).toBe(1);
  });

  it("declares only operationally safe transient categories as retryable", () => {
    expect(isRetryableAiProviderErrorCategory("rate_limited")).toBe(true);
    expect(isRetryableAiProviderErrorCategory("timeout")).toBe(true);
    expect(isRetryableAiProviderErrorCategory("service_unavailable")).toBe(true);
    expect(isRetryableAiProviderErrorCategory("auth_error")).toBe(false);
    expect(isRetryableAiProviderErrorCategory("invalid_request")).toBe(false);
    expect(isRetryableAiProviderErrorCategory("invalid_ai_output")).toBe(false);
  });
});
