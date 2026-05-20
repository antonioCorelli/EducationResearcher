import { randomUUID } from "node:crypto";

import type { GapMap } from "./gap-map.js";
import type { ObjectiveVersion } from "./objectives.js";
import type { InterviewSession, Run, SurveyResponse } from "./runs.js";
import type { SurveyVersion } from "./survey.js";

export const REALTIME_INTERVIEW_PROMPT_VERSION = "realtime-interview-v1";
export const DEFAULT_REALTIME_MODEL = "gpt-realtime";
export const DEFAULT_REALTIME_VOICE = "marin";
export const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export interface RealtimeInterviewPromptInput {
  readonly run: Run;
  readonly interviewSession: InterviewSession;
  readonly surveyVersion: SurveyVersion;
  readonly surveyResponses: readonly SurveyResponse[];
  readonly objectiveVersions: readonly ObjectiveVersion[];
  readonly gapMap?: GapMap;
  readonly personaStylePrompt: string;
  readonly remainingSeconds: number;
  readonly nowIso: string;
}

export interface RealtimeVoiceSessionRequest {
  readonly promptInput: RealtimeInterviewPromptInput;
  readonly instructions: string;
  readonly promptVersion: string;
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

export class FakeRealtimeVoiceProvider implements RealtimeVoiceProvider {
  async createSession(request: RealtimeVoiceSessionRequest): Promise<RealtimeVoiceSession> {
    return {
      provider: "fake",
      model: "fake-realtime-voice",
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
      readonly voice?: string;
      readonly fetch?: typeof fetch;
      readonly createServiceRequestId?: () => string;
    } = {}
  ) {}

  async createSession(request: RealtimeVoiceSessionRequest): Promise<RealtimeVoiceSession> {
    const apiKey = this.options.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required to create realtime voice sessions.");
    }

    const model = this.options.model ?? process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;
    const voice = this.options.voice ?? process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE;
    const serviceRequestId = this.options.createServiceRequestId?.() ?? `realtime_${randomUUID()}`;
    const fetchImplementation = this.options.fetch ?? fetch;
    const response = await fetchImplementation("https://api.openai.com/v1/realtime/client_secrets", {
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
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: true
              }
            },
            output: {
              voice
            }
          }
        }
      })
    });

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
      throw new Error(providerMessage);
    }

    const clientSecret = parseClientSecret(responseBody);

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

export function buildRealtimeInterviewInstructions(input: RealtimeInterviewPromptInput) {
  const responsesByQuestionId = new Map(
    input.surveyResponses.map((response) => [response.surveyQuestionId, response.responseText])
  );
  const surveyEvidence = getSurveyQuestions(input.surveyVersion).map((question, index) => ({
    questionNumber: index + 1,
    prompt: question.prompt,
    response: responsesByQuestionId.get(question.id) ?? ""
  }));
  const objectiveContext = input.objectiveVersions.map((objective, index) => ({
    objectiveNumber: index + 1,
    title: objective.title,
    description: objective.description,
    evidenceRequirements: objective.evidenceRequirements
  }));
  const gapMapContext = input.gapMap
    ? {
        status: input.gapMap.status,
        alreadyAnswered: input.gapMap.alreadyAnswered,
        ambiguities: input.gapMap.ambiguities,
        contradictions: input.gapMap.contradictions,
        missingEvidence: input.gapMap.missingEvidence,
        recommendedProbes: input.gapMap.recommendedProbes
      }
    : {
        status: "missing",
        alreadyAnswered: [],
        ambiguities: [],
        contradictions: [],
        missingEvidence: [],
        recommendedProbes: []
      };

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
    "- When the session starts, begin by asking a concise opening question based on the survey evidence and gap map.",
    "- Avoid technical or uncanny phrases such as \"I analyzed your prior responses\" or \"I detected uncertainty.\"",
    "- Do not reveal scoring objectives, rubrics, grades, hidden progress, gap map internals, or any evaluation strategy.",
    "- If time is nearly over, ask the single highest-value remaining question and then close warmly.",
    "",
    `Run state: ${input.run.status}`,
    `Remaining interview time: ${input.remainingSeconds} seconds`,
    `Current timestamp: ${input.nowIso}`,
    "",
    "Survey evidence:",
    JSON.stringify(surveyEvidence, null, 2),
    "",
    "Objective context for interviewer planning only:",
    JSON.stringify(objectiveContext, null, 2),
    "",
    "Gap map for interviewer planning only:",
    JSON.stringify(gapMapContext, null, 2)
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
