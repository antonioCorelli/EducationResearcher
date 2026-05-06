import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { buildServer } from "./server.js";

config({
  path: fileURLToPath(new URL("../.env", import.meta.url))
});

const DEFAULT_PORT = 4000;

export async function start() {
  const server = buildServer();
  const port = Number.parseInt(
    process.env.SERVICE_PORT ?? String(DEFAULT_PORT),
    10
  );

  if (!Number.isFinite(port)) {
    throw new Error("SERVICE_PORT must be a valid number.");
  }

  await server.listen({ host: "127.0.0.1", port });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
