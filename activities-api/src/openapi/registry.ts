import type { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";

export function setupOpenAPI(app: OpenAPIHono): void {
  // OpenAPI 3.1 JSON spec
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Operai Activities API",
      version: "0.1.0",
      description:
        "Activities, tasks and their blockers for the CRM (pre-sales) and the Projects tool " +
        "(operational), specs/028-activities. Requires a valid RS256 Bearer JWT issued by the " +
        "Operai auth service; who may see or change what is decided by the host (CRM or " +
        "Projects), asked as the caller on every request (ADR-0081).",
      contact: {
        name: "wellD",
        url: "https://welld.ch",
      },
    },
    servers: [{ url: "http://localhost:8087", description: "Local development" }],
    tags: [{ name: "System", description: "Health checks" }],
  });

  // Scalar UI at /docs
  app.get(
    "/docs",
    apiReference({
      spec: { url: "/openapi.json" },
      theme: "purple",
      layout: "modern",
    }),
  );
}
