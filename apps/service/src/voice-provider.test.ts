import { describe, expect, it } from "vitest";

import {
  FakeRealtimeVoiceProvider,
  OpenAiRealtimeVoiceProvider,
  RealtimeVoiceProviderError,
  buildRealtimeInterviewInstructions,
  type RealtimeInterviewPromptInput
} from "./voice-provider.js";

const promptInput: RealtimeInterviewPromptInput = {
  run: {
    id: "run_fixture_001",
    studyId: "study_fixture_001",
    participantSlotId: "slot_fixture_001",
    consentVersionId: "consent_version_001",
    surveyVersionId: "survey_version_001",
    personaVersionId: "persona_version_v1_default_001",
  objectiveVersionIds: ["objective_version_001"],
  freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
  maxInterviewMinutes: 45,
  allowWrittenInterviewResponses: true,
  status: "interview_in_progress",
    currentRunForSlot: true,
    createdAt: "2026-05-06T12:00:00.000Z",
    updatedAt: "2026-05-06T12:30:00.000Z"
  },
  interviewSession: {
    id: "interview_session_001",
    studyId: "study_fixture_001",
    participantSlotId: "slot_fixture_001",
    runId: "run_fixture_001",
    sessionNumber: 1,
    status: "active",
    startedAt: "2026-05-06T12:30:00.000Z",
    createdAt: "2026-05-06T12:30:00.000Z",
    updatedAt: "2026-05-06T12:30:00.000Z"
  },
  surveyVersion: {
    id: "survey_version_001",
    studyId: "study_fixture_001",
    versionNumber: 1,
    isActive: true,
    createdAt: "2026-05-06T12:00:00.000Z",
    layoutItems: [
      {
        type: "question",
        sortOrder: 1,
        question: {
          id: "survey_question_001",
          surveyVersionId: "survey_version_001",
          prompt: "What did you notice first?",
          required: true,
          questionType: "long_text",
          sortOrder: 1,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      }
    ],
    groups: [],
    ungroupedQuestions: []
  },
  surveyResponses: [
    {
      id: "survey_response_001",
      studyId: "study_fixture_001",
      participantSlotId: "slot_fixture_001",
      runId: "run_fixture_001",
      surveyVersionId: "survey_version_001",
      surveyQuestionId: "survey_question_001",
      responseText: "I noticed the example made my reasoning clearer.",
      submittedAt: "2026-05-06T12:10:00.000Z",
      createdAt: "2026-05-06T12:10:00.000Z"
    }
  ],
  interviewerInstructions: "Clarify how the example made the participant's reasoning clearer.",
  personaStylePrompt: "You are a calm research interviewer.",
  remainingSeconds: 1800,
  nowIso: "2026-05-06T12:30:00.000Z"
};

describe("realtime voice provider", () => {
  it("builds interview instructions with context and participant-safe boundaries", () => {
    const instructions = buildRealtimeInterviewInstructions(promptInput);

    expect(instructions).toContain("I noticed the example made my reasoning clearer.");
    expect(instructions).toContain("Clarify how the example made the participant's reasoning clearer.");
    expect(instructions).toContain("Researcher instructions for interviewer planning only");
    expect(instructions).toContain("Remaining interview time: 1800 seconds");
    expect(instructions).toContain("Ask exactly one question at a time.");
    expect(instructions).toContain("Keep spoken responses short");
    expect(instructions).toContain("Reference survey answers naturally");
    expect(instructions).toContain("Do not sound like you are grading");
    expect(instructions).toContain("Do not reveal scoring objectives");
    expect(instructions).not.toContain("Reasoning Quality");
    expect(instructions).not.toContain("intermediate artifact");
  });

  it("includes prior interview questions and answers when creating fresh realtime context", () => {
    const instructions = buildRealtimeInterviewInstructions({
      ...promptInput,
      interviewTurns: [
        {
          sequenceNumber: 1,
          speaker: "ai",
          text: "Can you tell me what made the example clearer?"
        },
        {
          sequenceNumber: 2,
          speaker: "participant",
          text: "The labels helped me connect each step to the equation."
        }
      ]
    });

    expect(instructions).toContain("Interview history so far");
    expect(instructions).toContain("Can you tell me what made the example clearer?");
    expect(instructions).toContain("The labels helped me connect each step to the equation.");
    expect(instructions).toContain("Do not ask the participant to repeat answers already captured");
  });

  it("mints an OpenAI realtime client secret without exposing the API key in the response", async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const provider = new OpenAiRealtimeVoiceProvider({
      apiKey: "test-api-key",
      model: "gpt-realtime",
      voice: "marin",
      createServiceRequestId: () => "req_realtime_001",
      fetch: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });

        return new Response(
          JSON.stringify({
            client_secret: {
              value: "ephemeral-client-secret",
              expires_at: 1_800_000_000
            }
          }),
          { status: 200 }
        );
      }) as typeof fetch
    });
    const instructions = buildRealtimeInterviewInstructions(promptInput);
    const session = await provider.createSession({
      promptInput,
      instructions,
      promptVersion: "realtime-interview-v1",
      voiceExperience: "standard"
    });

    expect(session).toEqual({
      provider: "openai",
      model: "gpt-realtime",
      voice: "marin",
      clientSecret: "ephemeral-client-secret",
      expiresAt: 1_800_000_000,
      realtimeUrl: "https://api.openai.com/v1/realtime/calls",
      serviceRequestId: "req_realtime_001",
      promptVersion: "realtime-interview-v1"
    });
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: "Bearer test-api-key",
      "content-type": "application/json"
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      session: {
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-transcribe"
            },
            turn_detection: null
          },
          output: {
            voice: "marin"
          }
        }
      }
    });
    expect(JSON.stringify(session)).not.toContain("test-api-key");
  });

  it("mints the new voice experience with the new realtime model without exposing the API key", async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const provider = new OpenAiRealtimeVoiceProvider({
      apiKey: "test-api-key",
      voice: "marin",
      createServiceRequestId: () => "req_new_realtime_001",
      fetch: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });

        return new Response(
          JSON.stringify({
            client_secret: {
              value: "new-ephemeral-client-secret",
              expires_at: 1_800_000_000
            }
          }),
          { status: 200 }
        );
      }) as typeof fetch
    });

    const session = await provider.createSession({
      promptInput,
      instructions: buildRealtimeInterviewInstructions(promptInput),
      promptVersion: "realtime-interview-v1",
      voiceExperience: "new_voice"
    });

    expect(session).toMatchObject({
      provider: "openai",
      model: "gpt-realtime-2.1",
      voice: "marin",
      clientSecret: "new-ephemeral-client-secret",
      serviceRequestId: "req_new_realtime_001"
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1"
      }
    });
    expect(JSON.stringify(session)).not.toContain("test-api-key");
    expect(String(requests[0]?.init.body)).not.toContain("test-api-key");
  });

  it("uses distinct deterministic fake models for each voice experience", async () => {
    const provider = new FakeRealtimeVoiceProvider();
    const request = {
      promptInput,
      instructions: buildRealtimeInterviewInstructions(promptInput),
      promptVersion: "realtime-interview-v1"
    } as const;

    const standardSession = await provider.createSession({ ...request, voiceExperience: "standard" });
    const newVoiceSession = await provider.createSession({ ...request, voiceExperience: "new_voice" });

    expect(standardSession.model).toBe("fake-realtime-voice");
    expect(newVoiceSession.model).toBe("fake-new-realtime-voice");
  });

  it("categorizes missing OpenAI realtime configuration without calling the provider", async () => {
    const provider = new OpenAiRealtimeVoiceProvider({
      apiKey: "",
      createServiceRequestId: () => "req_realtime_missing_config",
      fetch: (async () => {
        throw new Error("fetch should not be called");
      }) as typeof fetch
    });

    await expect(
      provider.createSession({
        promptInput,
        instructions: buildRealtimeInterviewInstructions(promptInput),
        promptVersion: "realtime-interview-v1",
        voiceExperience: "standard"
      })
    ).rejects.toMatchObject({
      name: "RealtimeVoiceProviderError",
      safeCategory: "missing_configuration",
      serviceRequestId: "req_realtime_missing_config"
    });
  });

  it("categorizes OpenAI realtime authentication failures without exposing the API key", async () => {
    const provider = new OpenAiRealtimeVoiceProvider({
      apiKey: "test-api-key",
      createServiceRequestId: () => "req_realtime_auth_error",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid API key"
            }
          }),
          { status: 401 }
        )) as typeof fetch
    });

    const error = await provider
      .createSession({
        promptInput,
        instructions: buildRealtimeInterviewInstructions(promptInput),
        promptVersion: "realtime-interview-v1",
        voiceExperience: "standard"
      })
      .catch((error: unknown) => error);

    expect(error).toBeInstanceOf(RealtimeVoiceProviderError);
    expect(error).toMatchObject({
      name: "RealtimeVoiceProviderError",
      safeCategory: "auth_error",
      serviceRequestId: "req_realtime_auth_error",
      providerStatus: 401
    });
    expect(JSON.stringify(error)).not.toContain("test-api-key");
  });
});
