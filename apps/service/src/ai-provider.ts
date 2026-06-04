export type AiPassKind = "scoring";

export type AiProviderErrorCategory =
  | "rate_limited"
  | "timeout"
  | "service_unavailable"
  | "auth_error"
  | "invalid_request"
  | "invalid_ai_output"
  | "provider_failure";

export interface AiModelMetadata {
  readonly modelName: string;
  readonly modelVersion: string;
  readonly serviceRequestId: string;
  readonly promptVersion: string;
}

export interface StructuredAiRequest<TInput> {
  readonly passKind: AiPassKind;
  readonly promptVersion: string;
  readonly input: TInput;
}

export interface StructuredAiProviderResponse {
  readonly output: unknown;
  readonly metadata: AiModelMetadata;
}

export interface StructuredAiProvider<TInput = unknown> {
  completeStructured(request: StructuredAiRequest<TInput>): Promise<StructuredAiProviderResponse>;
}

export class StructuredOutputValidationError extends Error {
  constructor(readonly safeMessage = "AI output was invalid.") {
    super(safeMessage);
    this.name = "StructuredOutputValidationError";
  }
}

export class AiProviderError extends Error {
  readonly safeCategory: AiProviderErrorCategory;
  readonly retryable: boolean;
  readonly serviceRequestId?: string;

  constructor(input: {
    readonly safeCategory: AiProviderErrorCategory;
    readonly message?: string;
    readonly retryable?: boolean;
    readonly serviceRequestId?: string;
  }) {
    super(input.message ?? "AI provider request failed.");
    this.name = "AiProviderError";
    this.safeCategory = input.safeCategory;
    this.retryable = input.retryable ?? isRetryableAiProviderErrorCategory(input.safeCategory);
    this.serviceRequestId = input.serviceRequestId;
  }
}

export interface ExecuteStructuredAiCallOptions<TInput, TOutput> {
  readonly provider: StructuredAiProvider<TInput>;
  readonly request: StructuredAiRequest<TInput>;
  readonly validate: (output: unknown, metadata: AiModelMetadata) => TOutput;
  readonly maxAttempts?: number;
}

export async function executeStructuredAiCall<TInput, TOutput>({
  provider,
  request,
  validate,
  maxAttempts = 3
}: ExecuteStructuredAiCallOptions<TInput, TOutput>): Promise<TOutput> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      const response = await provider.completeStructured(request);
      return validate(response.output, response.metadata);
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        throw new AiProviderError({
          safeCategory: "invalid_ai_output",
          message: error.safeMessage,
          retryable: false
        });
      }

      const providerError = toAiProviderError(error);

      if (!providerError.retryable || attempt >= maxAttempts) {
        throw providerError;
      }
    }
  }

  throw new AiProviderError({ safeCategory: "provider_failure", retryable: false });
}

export function toAiProviderError(error: unknown) {
  if (error instanceof AiProviderError) {
    return error;
  }

  if (error instanceof StructuredOutputValidationError) {
    return new AiProviderError({
      safeCategory: "invalid_ai_output",
      message: error.safeMessage,
      retryable: false
    });
  }

  return new AiProviderError({
    safeCategory: "provider_failure",
    message: error instanceof Error ? error.message : undefined
  });
}

export function isRetryableAiProviderErrorCategory(category: AiProviderErrorCategory) {
  return category === "rate_limited" || category === "timeout" || category === "service_unavailable";
}
