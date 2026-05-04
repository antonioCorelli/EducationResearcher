import Fastify, { type FastifyServerOptions } from "fastify";

export function buildServer(options: FastifyServerOptions = {}) {
  const server = Fastify({
    logger: true,
    ...options
  });

  server.get("/health", async () => ({
    service: "education-researcher-service",
    status: "ok"
  }));

  return server;
}
