import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { buildServer } from "./server.js";
import { validateProductionRuntimeConfig } from "./runtime-config.js";

config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url))
});

config({
  override: true,
  path: fileURLToPath(new URL("../.env", import.meta.url))
});

const DEFAULT_PORT = 4000;

export async function start() {
  validateProductionRuntimeConfig();

  const server = buildServer();
  const host =
    process.env.SERVICE_HOST ??
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  const port = Number.parseInt(
    process.env.SERVICE_PORT ?? process.env.PORT ?? String(DEFAULT_PORT),
    10
  );

  if (!host.trim()) {
    throw new Error("SERVICE_HOST must not be empty.");
  }

  if (!Number.isFinite(port)) {
    throw new Error("SERVICE_PORT must be a valid number.");
  }

  await server.listen({ host, port });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
