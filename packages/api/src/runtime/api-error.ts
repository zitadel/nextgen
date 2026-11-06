/**
 * Framework-neutral failure type the orval-generated client throws on
 * any non-2xx response. Carries the HTTP status, the parsed error body
 * (the spec's `{code, message, details?}` envelope when the server
 * returned one), and the request URL — enough for callers to map to
 * their own error taxonomy without re-implementing the fetch layer.
 *
 * Callers that don't care about the distinction can catch `ApiError`
 * generically; callers that do (the CLI's `toZitadelError`) read
 * `status` and decide.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  /**
   * The server's ID for the request, from its `X-Request-Id` header: the
   * reference that finds the request in the server's logs, to show beside the
   * error. `undefined` when the response carried none, as from a proxy.
   */
  readonly requestId: string | undefined;

  constructor(status: number, url: string, body: unknown, message: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
    this.requestId = requestId;
  }

  /**
   * The same failure with another message: the same class and fields, built anew
   * so the message and the stack agree. A subclass whose constructor differs
   * overrides it.
   */
  withMessage(message: string): this {
    const Failure = this.constructor as new (
      status: number,
      url: string,
      body: unknown,
      message: string,
      requestId?: string,
    ) => this;
    return new Failure(this.status, this.url, this.body, message, this.requestId);
  }
}
