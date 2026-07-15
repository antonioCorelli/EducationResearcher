const REQUIRED_PRODUCTION_ENV_VARS = [
  "AWS_REGION",
  "EDUCATION_RESEARCHER_ENV",
  "SERVICE_HOST",
  "SERVICE_PUBLIC_BASE_URL",
  "CORS_ORIGIN",
  "COGNITO_USER_POOL_ID",
  "COGNITO_CLIENT_ID",
  "STUDY_SHELL_STORE",
  "PARTICIPANT_SLOT_STORE",
  "CONSENT_VERSION_STORE",
  "SURVEY_VERSION_STORE",
  "OBJECTIVE_VERSION_STORE",
  "RUN_LIFECYCLE_STORE",
  "OPERATIONS_STORE",
  "PARTICIPANT_ACCESS_BASE_URL",
  "PARTICIPANT_ACCESS_TOKEN_SECRET",
  "AUDIO_LINK_SIGNING_SECRET",
  "OPENAI_API_KEY",
  "INTERVIEW_AUDIO_STORAGE_BACKEND",
  "ARTIFACT_STORAGE_BUCKET_NAME"
] as const;

const DYNAMODB_STORE_ENV_VARS = [
  "STUDY_SHELL_STORE",
  "PARTICIPANT_SLOT_STORE",
  "CONSENT_VERSION_STORE",
  "SURVEY_VERSION_STORE",
  "OBJECTIVE_VERSION_STORE",
  "RUN_LIFECYCLE_STORE",
  "OPERATIONS_STORE"
] as const;

const ALLOWED_PRODUCTION_CORS_ORIGINS = new Set(["https://voxaria.io", "https://www.voxaria.io"]);

export function validateProductionRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const missing = REQUIRED_PRODUCTION_ENV_VARS.filter((name) => !env[name]?.trim());
  const invalid = [
    ...validateExpectedValue(env, "EDUCATION_RESEARCHER_ENV", "prod"),
    ...validateExpectedValue(env, "SERVICE_HOST", "0.0.0.0"),
    ...validateExpectedValue(env, "SERVICE_PUBLIC_BASE_URL", "https://api.voxaria.io"),
    ...validateExpectedValue(env, "PARTICIPANT_ACCESS_BASE_URL", "https://voxaria.io"),
    ...validateExpectedValue(env, "INTERVIEW_AUDIO_STORAGE_BACKEND", "s3"),
    ...validateStoreModes(env),
    ...validateCorsOrigins(env.CORS_ORIGIN),
    ...validateOptionalBooleanFlag(env, "NEW_VOICE_MODEL_ENABLED")
  ];

  if (missing.length > 0 || invalid.length > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing ${missing.join(", ")}`] : []),
      ...(invalid.length > 0 ? [`invalid ${invalid.join(", ")}`] : [])
    ].join("; ");

    throw new Error(`Invalid production service configuration: ${details}.`);
  }
}

function validateExpectedValue(env: NodeJS.ProcessEnv, name: string, expectedValue: string) {
  const value = env[name]?.trim();

  if (!value || value === expectedValue) {
    return [];
  }

  return [name];
}

function validateStoreModes(env: NodeJS.ProcessEnv) {
  return DYNAMODB_STORE_ENV_VARS.filter((name) => {
    const value = env[name]?.trim();
    return value && value !== "dynamodb";
  });
}

function validateCorsOrigins(corsOrigin: string | undefined) {
  if (!corsOrigin?.trim()) {
    return [];
  }

  const configuredOrigins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins.length !== ALLOWED_PRODUCTION_CORS_ORIGINS.size) {
    return ["CORS_ORIGIN"];
  }

  return configuredOrigins.every((origin) => ALLOWED_PRODUCTION_CORS_ORIGINS.has(origin)) ? [] : ["CORS_ORIGIN"];
}

function validateOptionalBooleanFlag(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim().toLowerCase();

  if (value === undefined || value === "true" || value === "false") {
    return [];
  }

  return [name];
}
