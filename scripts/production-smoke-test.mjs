import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

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

function assertSafeCredentialTargetUrl(url, label) {
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

  if (url.protocol === "https:" || localHosts.has(url.hostname)) {
    return;
  }

  throw new Error(`Refusing to send smoke-test credentials to non-HTTPS ${label} origin: ${url.origin}`);
}

function getTimeoutMs() {
  return Number.parseInt(process.env.PRODUCTION_SMOKE_TIMEOUT_MS ?? `${defaultTimeoutMs}`, 10);
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = getTimeoutMs();
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

function getArtifactDirectory() {
  const artifactDirectory = process.env.PRODUCTION_SMOKE_ARTIFACT_DIR?.trim();

  return artifactDirectory || null;
}

async function saveFailureScreenshot(page) {
  const artifactDirectory = getArtifactDirectory();

  if (!artifactDirectory) {
    return;
  }

  mkdirSync(artifactDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: join(artifactDirectory, "production-smoke-failure.png")
  });
}

async function verifyUiLogin(webUrl, username, password) {
  const browser = await chromium.launch({
    headless: process.env.PRODUCTION_SMOKE_HEADLESS !== "false"
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(getTimeoutMs());

  try {
    await page.goto(webUrl.href, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /researcher sign in/iu }).waitFor();
    await page.getByLabel(/^email$/iu).fill(username);
    await page.getByLabel(/^password$/iu).fill(password);
    await page.getByRole("button", { name: /^sign in$/iu }).click();
    await page.waitForURL((url) => url.pathname === "/researcher");
    await page.getByRole("heading", { name: /welcome/iu }).waitFor();

    const welcomeNameInput = page.getByLabel("Preferred welcome name");
    const isWelcomeNameRequired = await welcomeNameInput.isVisible({ timeout: 1_000 }).catch(() => false);

    if (isWelcomeNameRequired) {
      await welcomeNameInput.fill("Smoke Test");
      await page.getByRole("button", { name: /^confirm$/iu }).click();
    }

    await page.getByText("Researcher workspace", { exact: true }).waitFor();
    await page.getByRole("button", { name: /^sign out$/iu }).waitFor();
    await page.getByRole("button", { name: /^sign out$/iu }).click();
  } catch (error) {
    await saveFailureScreenshot(page).catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}

async function runSmokeTest() {
  loadOptionalLocalEnv();

  const webUrl = optionalUrlEnv("PRODUCTION_SMOKE_WEB_URL", "https://voxaria.io");
  const apiUrl = optionalUrlEnv("PRODUCTION_SMOKE_API_URL", "https://api.voxaria.io");
  const username = requiredEnv("VOXARIA_SMOKE_USERNAME");
  const password = requiredEnv("VOXARIA_SMOKE_PASSWORD");
  assertSafeCredentialTargetUrl(webUrl, "web app");
  assertSafeCredentialTargetUrl(apiUrl, "API");

  await verifyWebApp(webUrl);
  await verifyApiHealth(apiUrl);
  await verifyUiLogin(webUrl, username, password);
}

function getRetrySettings() {
  return {
    attempts: Number.parseInt(process.env.PRODUCTION_SMOKE_ATTEMPTS ?? "1", 10),
    initialDelayMs: Number.parseInt(process.env.PRODUCTION_SMOKE_INITIAL_DELAY_MS ?? "0", 10),
    delayMs: Number.parseInt(process.env.PRODUCTION_SMOKE_DELAY_MS ?? "0", 10)
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { attempts, delayMs, initialDelayMs } = getRetrySettings();
  const maxAttempts = Number.isFinite(attempts) && attempts > 0 ? attempts : 1;
  const firstRunDelayMs = Number.isFinite(initialDelayMs) && initialDelayMs > 0 ? initialDelayMs : 0;
  const retryDelayMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;

  if (firstRunDelayMs > 0) {
    console.log(`Waiting ${firstRunDelayMs}ms before starting the production smoke test.`);
    await delay(firstRunDelayMs);
  }

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
