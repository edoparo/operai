import { bucket, defineRailway, github, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "europe-west4-drams3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 50000 });
  const inventory = bucket("inventory", { region: "ams" });
  const refund = bucket("refund", { region: "ams" });
  const crm = bucket("crm", { region: "ams" });
  const meetings = bucket("meetings", { region: "ams" });
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

  return project("operai", {
    variables: { managed: false },
    resources: [refundApi, Postgres, meetingsApi, activitiesApi, crmApi, projectsApi, auth, notifyApi, estimaiApi, inventoryApi, postgresVolume, inventory, refund, crm, meetings],
  });
});
