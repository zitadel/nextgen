import type { ZitadelClient } from "./client";

/** One page of a list, and the cursor to the next page when one remains. */
export type Page<T> = Readonly<{
  items: readonly T[];
  next: string | null;
}>;

/**
 * The base of every service: a Service Layer (Fowler, PoEAA) over the generated
 * API client, which plays the Gateway.
 *
 * @remarks
 * A command says what should happen and never which endpoint serves it. A
 * service is built on the client the run made, and one that concerns a single
 * project is bound to it at construction too, so a call carries only what is
 * specific to it. Results are Value Objects: immutable, compared by content,
 * and free of presentation.
 */
export abstract class ApiService {
  protected readonly client: ZitadelClient;

  /**
   * Bind the service to a client.
   *
   * @param client - The client every call goes through.
   */
  constructor(client: ZitadelClient) {
    this.client = client;
  }
}
