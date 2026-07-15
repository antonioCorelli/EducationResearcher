import { randomUUID } from "node:crypto";

import type { InterviewSession, InterviewTurnSpeaker, Run, SurveyResponse } from "./runs.js";
import type { SurveyVersion } from "./survey.js";

export const REALTIME_INTERVIEW_PROMPT_VERSION = "realtime-interview-v1";
export const DEFAULT_REALTIME_MODEL = "gpt-realtime";
export const DEFAULT_NEW_REALTIME_MODEL = "gpt-realtime-2.1";
export const DEFAULT_REALTIME_VOICE = "marin";
export const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type RealtimeVoiceExperience = "standard" | "new_voice";

export type RealtimeVoiceProviderErrorCategory =
  | "missing_configuration"
  | "auth_error"
  | "invalid_request"
  | "rate_limited"
  | "service_unavailable"
  | "provider_failure";

export interface RealtimeInterviewPromptInput {
  readonly run: Run;
  readonly interviewSession: InterviewSession;
  readonly surveyVersion: SurveyVersion;
  readonly surveyResponses: readonly SurveyResponse[];
  readonly interviewTurns?: readonly RealtimeInterviewContextTurn[];
  readonly interviewerInstructions?: string;
  readonly personaStylePrompt: string;
  readonly remainingSeconds: number;
  readonly nowIso: string;
}

export interface RealtimeInterviewContextTurn {
  readonly speaker: InterviewTurnSpeaker;
  readonly text: string;
  readonly sequenceNumber?: number;
}

export interface RealtimeVoiceSessionRequest {
  readonly promptInput: RealtimeInterviewPromptInput;
  readonly instructions: string;
  readonly promptVersion: string;
  readonly voiceExperience: RealtimeVoiceExperience;
}

export interface RealtimeVoiceSession {
  readonly provider: "fake" | "openai";
  readonly model: string;
  readonly voice: string;
  readonly clientSecret: string;
  readonly expiresAt?: number;
  readonly realtimeUrl: string;
  readonly serviceRequestId: string;
  readonly promptVersion: string;
}

export interface RealtimeVoiceProvider {
  createSession(request: RealtimeVoiceSessionRequest): Promise<RealtimeVoiceSession>;
}

export class RealtimeVoiceProviderError extends Error {
  readonly safeCategory: RealtimeVoiceProviderErrorCategory;
  readonly serviceRequestId: string;
  readonly providerStatus?: number;

  constructor(input: {
    readonly safeCategory: RealtimeVoiceProviderErrorCategory;
    readonly serviceRequestId: string;
    readonly message?: string;
    readonly providerStatus?: number;
  }) {
    super(input.message ?? "Realtime voice provider request failed.");
    this.name = "RealtimeVoiceProviderError";
    this.safeCategory = input.safeCategory;
    this.serviceRequestId = input.serviceRequestId;
    this.providerStatus = input.providerStatus;
  }
}

export class FakeRealtimeVoiceProvider implements RealtimeVoiceProvider {
  async createSession(request: RealtimeVoiceSessionRequest): Promise<RealtimeVoiceSession> {
    return {
      provider: "fake",
      model: request.voiceExperience === "new_voice" ? "fake-new-realtime-voice" : "fake-realtime-voice",
      voice: "fake-voice",
      clientSecret: "fake-realtime-client-secret",
      realtimeUrl: OPENAI_REALTIME_CALLS_URL,
      serviceRequestId: "fake-realtime-request",
      promptVersion: request.promptVersion
    };
  }
}

export class OpenAiRealtimeVoiceProvider implements RealtimeVoiceProvider {
  constructor(
    private readonly options: {
      readonly apiKey?: string;
      readonly model?: string;
      readonly newModel?: string;
      readonly voice?: string;
      readonly fetch?: typeof fetch;
      readonly createServiceRequestId?: () => string;
    } = {}
  ) {}

  async createSession(request: RealtimeVoiceSessionRequest): Promise<RealtimeVoiceSession> {
    const serviceRequestId = this.options.createServiceRequestId?.() ?? `realtime_${randomUUID()}`;
    const apiKey = this.options.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new RealtimeVoiceProviderError({
        safeCategory: "missing_configuration",
        serviceRequestId,
        message: "OPENAI_API_KEY is required to create realtime voice sessions."
      });
    }

    const model =
      request.voiceExperience === "new_voice"
        ? this.options.newModel ?? process.env.OPENAI_NEW_REALTIME_MODEL ?? DEFAULT_NEW_REALTIME_MODEL
        : this.options.model ?? process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;
    const voice = this.options.voice ?? process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE;
    const fetchImplementation = this.options.fetch ?? fetch;
    let response: Response;

    try {
      response = await fetchImplementation("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model,
            instructions: request.instructions,
            audio: {
              input: {
                transcription: {
                  model: "gpt-4o-transcribe"
                },
                turn_detection: null
              },
              output: {
                voice
              }
            }
          }
        })
      });
    } catch {
      throw new RealtimeVoiceProviderError({
        safeCategory: "provider_failure",
        serviceRequestId
      });
    }

    const responseBody = (await response.json().catch(() => undefined)) as
      | {
          readonly value?: unknown;
          readonly expires_at?: unknown;
          readonly client_secret?: {
            readonly value?: unknown;
            readonly expires_at?: unknown;
          };
          readonly error?: {
            readonly message?: unknown;
          };
        }
      | undefined;

    if (!response.ok) {
      const providerMessage =
        typeof responseBody?.error?.message === "string" ? responseBody.error.message : "Realtime provider request failed.";
      throw new RealtimeVoiceProviderError({
        safeCategory: mapOpenAiRealtimeStatusToCategory(response.status),
        serviceRequestId,
        providerStatus: response.status,
        message: providerMessage
      });
    }

    let clientSecret: string;

    try {
      clientSecret = parseClientSecret(responseBody);
    } catch (error) {
      throw new RealtimeVoiceProviderError({
        safeCategory: "provider_failure",
        serviceRequestId,
        message: error instanceof Error ? error.message : undefined
      });
    }

    return {
      provider: "openai",
      model,
      voice,
      clientSecret,
      expiresAt: parseOptionalExpiresAt(responseBody),
      realtimeUrl: OPENAI_REALTIME_CALLS_URL,
      serviceRequestId,
      promptVersion: request.promptVersion
    };
  }
}

export function createConfiguredRealtimeVoiceProvider(): RealtimeVoiceProvider {
  if (process.env.REALTIME_VOICE_PROVIDER === "openai" || process.env.OPENAI_API_KEY) {
    return new OpenAiRealtimeVoiceProvider();
  }

  if (process.env.NODE_ENV === "production") {
    return new OpenAiRealtimeVoiceProvider();
  }

  return new FakeRealtimeVoiceProvider();
}

export function toRealtimeVoiceProviderError(error: unknown) {
  if (error instanceof RealtimeVoiceProviderError) {
    return error;
  }

  return new RealtimeVoiceProviderError({
    safeCategory: "provider_failure",
    serviceRequestId: "unknown",
    message: error instanceof Error ? error.message : undefined
  });
}

function mapOpenAiRealtimeStatusToCategory(status: number): RealtimeVoiceProviderErrorCategory {
  if (status === 401 || status === 403) {
    return "auth_error";
  }

  if (status === 400 || status === 404) {
    return "invalid_request";
  }

  if (status === 429) {
    return "rate_limited";
  }

  if (status >= 500) {
    return "service_unavailable";
  }

  return "provider_failure";
}

export function buildRealtimeInterviewInstructions(input: RealtimeInterviewPromptInput) {
  const responsesByQuestionId = new Map(
    input.surveyResponses.map((response) => [response.surveyQuestionId, response.responseText])
  );
  const surveyEvidence = getSurveyQuestions(input.surveyVersion).map((question, index) => ({
    questionNumber: index + 1,
    prompt: question.prompt,
    response: responsesByQuestionId.get(question.id) ?? ""
  }));
  const interviewHistory = (input.interviewTurns ?? []).map((turn, index) => ({
    turnNumber: turn.sequenceNumber ?? index + 1,
    speaker: turn.speaker,
    text: turn.text
  }));
  const interviewerInstructions = input.interviewerInstructions?.trim() || "No study-specific interviewer instructions were provided.";

  return [
    input.personaStylePrompt,
    "",
    "Interview operating rules:",
    "- Ask exactly one question at a time.",
    "- Keep spoken responses short: one brief acknowledgment plus one clear follow-up question.",
    "- Use plain, supportive language. Do not sound like you are grading, scoring, diagnosing, or testing the participant.",
    "- Probe naturally for concrete examples, clarification, contradictions, and missing evidence.",
    "- Briefly acknowledge answers, then continue with the next most useful follow-up.",
    "- Reference survey answers naturally, for example: \"Earlier, you said science feels useful when it connects to real problems...\"",
    "- When the session starts, begin by asking a concise opening question based on the survey evidence and researcher instructions.",
    "- If interview history is present, continue from it naturally. Do not ask the participant to repeat answers already captured unless clarification is useful.",
    "- Avoid technical or uncanny phrases such as \"I analyzed your prior responses\" or \"I detected uncertainty.\"",
    "- Do not reveal scoring objectives, rubrics, grades, hidden progress, or any evaluation strategy.",
    "- If time is nearly over, ask the single highest-value remaining question and then close warmly.",
    "",
    `Run state: ${input.run.status}`,
    `Remaining interview time: ${input.remainingSeconds} seconds`,
    `Current timestamp: ${input.nowIso}`,
    "",
    "Survey evidence:",
    JSON.stringify(surveyEvidence, null, 2),
    "",
    "Interview history so far:",
    interviewHistory.length > 0 ? JSON.stringify(interviewHistory, null, 2) : "No interview turns have been recorded yet.",
    "",
    "Researcher instructions for interviewer planning only:",
    interviewerInstructions
  ].join("\n");
}

function parseClientSecret(responseBody: { readonly value?: unknown; readonly client_secret?: { readonly value?: unknown } } | undefined) {
  const value = responseBody?.client_secret?.value ?? responseBody?.value;

  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Realtime provider response did not include a client secret.");
  }

  return value;
}

function parseOptionalExpiresAt(
  responseBody: { readonly expires_at?: unknown; readonly client_secret?: { readonly expires_at?: unknown } } | undefined
) {
  const expiresAt = responseBody?.client_secret?.expires_at ?? responseBody?.expires_at;

  return typeof expiresAt === "number" ? expiresAt : undefined;
}

function getSurveyQuestions(surveyVersion: SurveyVersion) {
  return surveyVersion.layoutItems.flatMap((item) => {
    if (item.type === "question") {
      return [item.question];
    }

    return item.group.questions;
  });
}
