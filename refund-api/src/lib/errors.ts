import { Data } from "effect";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly statusCode?: number;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly fields?: Record<string, string[]>;
}> {}

export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ConflictError extends Data.TaggedError("ConflictError")<{
  readonly message: string;
  readonly cause?: unknown;
  /**
   * Optional stable discriminator surfaced as the Problem JSON `code`
   * extension member, for a 409 the UI must tell apart from the generic
   * "changed concurrently" one (e.g. `line_rejected`, `all_lines_rejected`).
   */
  readonly code?: string;
}> {}

/**
 * specs/20260721-self-approval-control, ADR 20260721-self-approval-condition-and-403-exception — a restricted `request:approve`
 * grant (`{key:"self-approval", match:"deny"}`) was used to attempt approving
 * a request the caller themselves owns. Maps to a distinguishable 403 (NOT
 * the suite's usual "not yours = 404", ADR 20260703-jwt-resource-server-remote-jwks/0014) because the caller
 * provably owns and can otherwise act on the record — see decide.routes.ts.
 */
export class SelfApprovalDeniedError extends Data.TaggedError(
  "SelfApprovalDeniedError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type AppError =
  | DatabaseError
  | NotFoundError
  | AuthError
  | ValidationError
  | ForbiddenError
  | ConflictError
  | SelfApprovalDeniedError;
