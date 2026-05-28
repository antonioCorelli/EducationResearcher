import { describe, expect, it } from "vitest";

import {
  OpenAiRealtimeVoiceProvider,
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
  objectiveVersions: [
    {
      id: "objective_version_001",
      studyId: "study_fixture_001",
      objectiveKey: "reasoning_quality",
      versionNumber: 1,
      title: "Reasoning Quality",
      description: "Explains reasoning.",
      gradeScale: ["1", "2"],
      gradeExamples: [],
      evidenceRequirements: "Use interview evidence.",
      sortOrder: 1,
      isEnabled: true,
      isActive: true,
      createdAt: "2026-05-06T12:00:00.000Z"
    }
  ],
  gapMap: {
    id: "gap_map_001",
    studyId: "study_fixture_001",
    participantSlotId: "slot_fixture_001",
    runId: "run_fixture_001",
    surveyVersionId: "survey_version_001",
    objectiveVersionIds: ["objective_version_001"],
    status: "generated",
    modelName: "fake-gap-map",
    modelVersion: "local-1",
    serviceRequestId: "req_gap_map_001",
    promptVersion: "gap-map-v1",
    alreadyAnswered: ["Initial evidence is present."],
    ambiguities: ["Needs elaboration."],
    contradictions: [],
    missingEvidence: ["Need a concrete example."],
    recommendedProbes: ["Can you share a concrete example?"],
    generatedAt: "2026-05-06T12:11:00.000Z",
    createdAt: "2026-05-06T12:11:00.000Z"
  },
  personaStylePrompt: "You are a calm research interviewer.",
  remainingSeconds: 1800,
  nowIso: "2026-05-06T12:30:00.000Z"
};

describe("realtime voice provider", () => {
  it("builds interview instructions with context and participant-safe boundaries", () => {
    const instructions = buildRealtimeInterviewInstructions(promptInput);

    expect(instructions).toContain("I noticed the example made my reasoning clearer.");
    expect(instructions).toContain("Reasoning Quality");
    expect(instructions).toContain("Can you share a concrete example?");
    expect(instructions).toContain("Remaining interview time: 1800 seconds");
    expect(instructions).toContain("Ask exactly one question at a time.");
    expect(instructions).toContain("Keep spoken responses short");
    expect(instructions).toContain("Reference survey answers naturally");
    expect(instructions).toContain("Do not sound like you are grading");
    expect(instructions).toContain("Do not reveal scoring objectives");
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
      promptVersion: "realtime-interview-v1"
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
});
