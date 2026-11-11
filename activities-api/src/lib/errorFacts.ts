/**
 * What a log line may say about a caught error: its NAME and, when it has one, its CODE. Never
 * its message or stack: a database or driver error's message can carry the statement and its
 * parameters, which are free text about clients (OWASP review L2, same rule as the global
 * handler in index.ts).
 */
export function errorFacts(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? `${error.name} ${code}` : error.name;
}
