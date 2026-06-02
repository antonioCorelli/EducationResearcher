import { existsSync, readFileSync } from "node:fs";

const defaultTimeoutMs = 10_000;

function parseEnvFile(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (!key || key.startsWith("export ")) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function loadOptionalLocalEnv(envFilePath = process.env.PRODUCTION_SMOKE_ENV_FILE ?? ".env.production-smoke.local") {
  if (!existsSync(envFilePath)) {
    return;
  }

  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(envFilePath, "utf8")))) {
    process.env[key] ??= value;
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function optionalUrlEnv(name, fallback) {
  return new URL(process.env[name]?.trim() || fallback);
}

function assertSafeCredentialUrl(url) {
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

  if (url.protocol === "https:" || localHosts.has(url.hostname)) {
    return;
  }

  throw new Error(`Refusing to send smoke-test credentials to non-HTTPS API origin: ${url.origin}`);
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number.parseInt(process.env.PRODUCTION_SMOKE_TIMEOUT_MS ?? `${defaultTimeoutMs}`, 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response, fallbackMessage) {
  const payload = await response.json().catch(() => undefined);

  if (payload === undefined) {
    throw new Error(fallbackMessage);
  }

  return payload;
}

async function expectOk(response, label) {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");
  const suffix = body ? ` Body: ${body.slice(0, 240)}` : "";

  throw new Error(`${label} returned ${response.status}.${suffix}`);
}

async function verifyWebApp(webUrl) {
  const response = await fetchWithTimeout(webUrl);
  await expectOk(response, `GET ${webUrl.href}`);

  const html = await response.text();

  if (!html.includes('<div id="root"')) {
    throw new Error(`GET ${webUrl.href} did not return the expected app shell.`);
  }
}

async function verifyApiHealth(apiUrl) {
  const healthUrl = new URL("/health", apiUrl);
  const response = await fetchWithTimeout(healthUrl);
  await expectOk(response, `GET ${healthUrl.href}`);

  const payload = await readJson(response, "Health response was not JSON.");

  if (payload.status !== "ok") {
    throw new Error(`Health response did not report ok status.`);
  }
}

async function signIn(apiUrl, username, password) {
  const signInUrl = new URL("/auth/sign-in", apiUrl);
  const response = await fetchWithTimeout(signInUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: username,
      password
    })
  });
  await expectOk(response, `POST ${signInUrl.href}`);

  const payload = await readJson(response, "Sign-in response was not JSON.");
  const accessToken = payload?.tokens?.accessToken;

  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Sign-in response did not include an access token.");
  }

  return accessToken;
}

async function verifyAuthenticatedWorkspace(apiUrl, accessToken) {
  const sessionUrl = new URL("/researcher/session", apiUrl);
  const studiesUrl = new URL("/researcher/studies", apiUrl);

  const sessionResponse = await fetchWithTimeout(sessionUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  await expectOk(sessionResponse, `GET ${sessionUrl.href}`);

  const sessionPayload = await readJson(sessionResponse, "Session response was not JSON.");

  if (typeof sessionPayload?.user?.id !== "string" || sessionPayload.user.role !== "researcher") {
    throw new Error("Session response did not include an authenticated researcher.");
  }

  const studiesResponse = await fetchWithTimeout(studiesUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  await expectOk(studiesResponse, `GET ${studiesUrl.href}`);

  const studiesPayload = await readJson(studiesResponse, "Studies response was not JSON.");

  if (!Array.isArray(studiesPayload.studies)) {
    throw new Error("Studies response did not include a studies array.");
  }
}

async function signOut(apiUrl, accessToken) {
  const signOutUrl = new URL("/auth/sign-out", apiUrl);

  await fetchWithTimeout(signOutUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  }).catch(() => undefined);
}

async function runSmokeTest() {
  loadOptionalLocalEnv();

  const webUrl = optionalUrlEnv("PRODUCTION_SMOKE_WEB_URL", "https://voxaria.io");
  const apiUrl = optionalUrlEnv("PRODUCTION_SMOKE_API_URL", "https://api.voxaria.io");
  const username = requiredEnv("VOXARIA_SMOKE_USERNAME");
  const password = requiredEnv("VOXARIA_SMOKE_PASSWORD");
  assertSafeCredentialUrl(apiUrl);

  await verifyWebApp(webUrl);
  await verifyApiHealth(apiUrl);

  const accessToken = await signIn(apiUrl, username, password);

  try {
    await verifyAuthenticatedWorkspace(apiUrl, accessToken);
  } finally {
    await signOut(apiUrl, accessToken);
  }
}

function getRetrySettings() {
  return {
    attempts: Number.parseInt(process.env.PRODUCTION_SMOKE_ATTEMPTS ?? "1", 10),
    delayMs: Number.parseInt(process.env.PRODUCTION_SMOKE_DELAY_MS ?? "0", 10)
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { attempts, delayMs } = getRetrySettings();
  const maxAttempts = Number.isFinite(attempts) && attempts > 0 ? attempts : 1;
  const retryDelayMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runSmokeTest();
      console.log(`Production smoke test passed on attempt ${attempt}.`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Production smoke test failed.";

      if (attempt === maxAttempts) {
        throw new Error(message);
      }

      console.warn(`Production smoke test attempt ${attempt} failed: ${message}`);
      await delay(retryDelayMs);
    }
  }
}

await main();
