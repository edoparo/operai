/**
 * Channel abstraction (T2, specs/20260713-user-invitations, plan.md §notify-api
 * email channel, ADR 20260714-notify-api-email-channel-service-trust).
 *
 * notify-api gained a second delivery channel alongside its original in-app/
 * SSE one (specs/20260713-notification-center). Both share nothing about *how* they address a
 * recipient — `inApp` addresses a JWT `sub`, `email` addresses a raw email
 * string — so this interface is deliberately minimal: one `send` method,
 * generic over each channel's own input/result shape. It exists so both
 * implementations live under one conceptual seam (`src/channels/`) without
 * forcing a shared addressing model that would leak one channel's concerns
 * into the other's (see ADR 20260714-notify-api-email-channel-service-trust "the address-vs-sub split lives entirely in
 * the channel layer").
 */
export interface Channel<TInput, TResult> {
  send(input: TInput): Promise<TResult>;
}
