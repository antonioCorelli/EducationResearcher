import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import {
  AuthenticationError,
  createConfiguredAuthProvider,
  type AuthProvider,
  type SessionUser
} from "./auth.js";

interface BuildServerOptions extends FastifyServerOptions {
  readonly authProvider?: AuthProvider;
  readonly corsOrigin?: string | string[];
}

interface SignInBody {
  readonly email?: unknown;
  readonly password?: unknown;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

function getBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length).trim();
}

function parseCredentials(body: SignInBody) {
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    throw new AuthenticationError("Email and password are required.");
  }

  const email = body.email.trim().toLowerCase();

  if (!email || !body.password) {
    throw new AuthenticationError("Email and password are required.");
  }

  return {
    email,
    password: body.password
  };
}

export function buildServer(options: BuildServerOptions = {}) {
  const { authProvider, corsOrigin = true, ...fastifyOptions } = options;
  let resolvedAuthProvider = authProvider;
  const server = Fastify({
    logger: true,
    ...fastifyOptions
  });

  void server.register(cors, {
    origin: corsOrigin
  });

  const getAuthProvider = () => {
    resolvedAuthProvider ??= createConfiguredAuthProvider();
    return resolvedAuthProvider;
  };

  const requireResearcher = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = getBearerToken(request);

    if (!token) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Researcher sign-in is required."
      });
    }

    try {
      request.user = await getAuthProvider().verifyAccessToken(token);
    } catch {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Researcher sign-in is required."
      });
    }
  };

  server.get("/health", async () => ({
    service: "education-researcher-service",
    status: "ok"
  }));

  server.post<{ Body: SignInBody }>("/auth/sign-in", async (request, reply) => {
    try {
      const credentials = parseCredentials(request.body);
      const tokens = await getAuthProvider().signIn(credentials.email, credentials.password);

      return {
        tokens
      };
    } catch {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Email or password is incorrect."
      });
    }
  });

  server.post("/auth/sign-out", { preHandler: requireResearcher }, async (request, reply) => {
    const token = getBearerToken(request);

    if (token) {
      await getAuthProvider().signOut(token);
    }

    return reply.code(204).send();
  });

  server.get("/researcher/session", { preHandler: requireResearcher }, async (request) => ({
    user: request.user
  }));

  server.get("/researcher/dashboard", { preHandler: requireResearcher }, async (request) => ({
    researcher: request.user,
    message: "Researcher workspace is ready for authenticated study setup."
  }));

  server.get("/participant/demo", async () => ({
    participantRoute: "public",
    message: "Participant routes do not require researcher sign-in."
  }));

  return server;
}
