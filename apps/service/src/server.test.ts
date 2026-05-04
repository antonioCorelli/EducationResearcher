import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("health route", () => {
  it("returns service health status", async () => {
    const server = buildServer({ logger: false });
    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "education-researcher-service",
      status: "ok"
    });

    await server.close();
  });
});
