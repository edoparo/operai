import { bucket, defineRailway, github, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "europe-west4-drams3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 50000 });
  const inventory = bucket("inventory", { region: "ams" });
  const refund = bucket("refund", { region: "ams" });
  const crm = bucket("crm", { region: "ams" });
  const meetings = bucket("meetings", { region: "ams" });
  // ADR 20261113-task-description-files-in-activities-api-bucket: task images and attachments (activities-api). Private, EU; a bucket's region cannot change.
  const activities = bucket("activities", { region: "ams" });
  // specs/20261116-letterhead-service: logos and backgrounds of the letterheads (letterhead-api). Private, EU; a bucket's region cannot change.
  const letterhead = bucket("letterhead", { region: "ams" });
  const refundApi = service("refund-api", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/refund-api" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: ["refund-api.operai.welld.io"],
    networking: { privateNetworkEndpoint: "operai-b6e4" },
  });
  const meetingsApi = service("meetings-api", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/meetings-api" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: [{ domain: "meetings-api.operai.welld.io", port: 8085 }],
  });
  const activitiesApi = service("activities-api", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/activities-api" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: [{ domain: "activities-api.operai.welld.io", port: 8087 }],
  });
  const crmApi = service("crm-api", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/crm-api" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: [{ domain: "crm-api.operai.welld.io", port: 8084 }],
  });
  const projectsApi = service("projects-api", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/projects-api" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: [{ domain: "projects-api.operai.welld.io", port: 8086 }],
  });
  const auth = service("auth", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/auth" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:release",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3, limitOverride: { containers: { cpu: 24, memoryBytes: 24000000000 } } },
    domains: [{ domain: "auth.operai.welld.io", port: 3001 }],
  });
  const notifyApi = service("notify-api", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/notify-api" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: ["notify-api.operai.welld.io"],
    networking: { privateNetworkEndpoint: "operai" },
  });
  const estimaiApi = service("estimai-api", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/estimai-api" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3, limitOverride: { containers: { cpu: 24, memoryBytes: 24000000000 } } },
    domains: ["estimai-api.operai.welld.io"],
  });
  const inventoryApi = service("inventory-api", {
    source: github("matteocodogno/operai", { branch: "main", checkSuites: false, rootDirectory: "/inventory-api" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "bun run src/index.ts",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "bun run db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: [{ domain: "inventory-api.operai.welld.io", port: 8083 }],
  });
  // specs/20261116-letterhead-service (ADR 20261116-letterhead-api-is-a-rust-service-with-typst-embedded-for-document-layout-only): the one Rust service.
  // - start / preDeploy are whole commands (plan, amendment 2026-11-17 item 4): the image has CMD, not ENTRYPOINT, and `letterhead-api migrate` reads only
  //   DATABASE_URL. `serve` never migrates, so the preDeploy is the only place the schema changes.
  // - limitOverride is sized for the render pool (ADR 20261116-renders-run-in-killable-worker-processes-and-concurrency-is-bounded-by-memory): 2 workers
  //   (LH_WORKERS) x 2 GiB RSS cap (T46: the worst accepted table peaks at 1.53 GiB on Linux), plus the supervisor, 6 queued 20 MiB bodies and the poll's overshoot = 5 GB. cpu 2: one core per worker. Both are the
  //   figures the local perf proxy runs with (letterhead-api/perf/README.md); raise them with a measurement, never to hide a 429.
  // - Single replica: the pool, its queue and the per-caller share are in-process, so a second replica would double the bound, not share it.
  // - No `source` yet: per .claude/skills/provision-tool/SKILL.md the service is declared unbuilt, its variables are set, and only then is the source added (T40).
  const letterheadApi = service("letterhead-api", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "letterhead-api",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "letterhead-api migrate",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3, limitOverride: { containers: { cpu: 2, memoryBytes: 5000000000 } } },
    // Custom domain: Railway configuration cannot register one (`railway config plan` refuses it). Per T40: add
    // letterhead-api.operai.welld.io → 8088 in the dashboard, run `railway config pull`, then declare it here as
    // `domains: [{ domain: "letterhead-api.operai.welld.io", port: 8088 }]`, as the other services do.
  });

  return project("operai", {
    variables: { managed: false },
    resources: [refundApi, Postgres, meetingsApi, activitiesApi, crmApi, projectsApi, auth, notifyApi, estimaiApi, inventoryApi, letterheadApi, postgresVolume, inventory, refund, crm, meetings, activities, letterhead],
  });
});
