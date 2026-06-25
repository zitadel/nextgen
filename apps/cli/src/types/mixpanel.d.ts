/**
 * Minimal ambient declaration for the `mixpanel` (Node server-side) package.
 *
 * The published package ships no types and the community `@types/mixpanel`
 * targets the browser SDK, whose surface differs. Rather than pull in a
 * mismatched dependency, we declare the narrow slice the telemetry module
 * actually uses, in keeping with the repo's typed-everywhere philosophy. If the
 * telemetry client grows to need `people`, `groups`, or `import`, extend this
 * declaration alongside the new usage rather than loosening it to `any`.
 */
declare module "mixpanel" {
  /** Properties bag for a tracked event. Mixpanel ingests a flat, single-level map. */
  export type PropertyValue = string | number | boolean | null | undefined;
  export type Properties = Record<string, PropertyValue>;

  /** Node-callback signature Mixpanel uses to report transport errors. */
  export type Callback = (error: Error | undefined) => void;

  /** Subset of the init options we rely on. */
  export interface InitConfig {
    /**
     * API host without scheme, e.g. `api-eu.mixpanel.com` for EU data
     * residency. Defaults to `api.mixpanel.com` (US) when omitted.
     */
    host?: string;
    /** Disable IP-based geolocation lookups on ingestion. */
    geolocate?: boolean;
  }

  /**
   * Message-level modifiers for a profile update. `$ip` belongs here (not in the
   * `$set` properties) — it is a top-level `/engage` param that controls IP
   * geolocation; `0` disables it.
   */
  export interface Modifiers {
    $ip?: number | string;
    $ignore_time?: boolean;
    $time?: number;
  }

  /** People (profile) API — used to register each anonymous install as a user. */
  export interface People {
    set(
      distinctId: string,
      properties: Properties,
      modifiers?: Modifiers,
      callback?: Callback,
    ): void;
    set_once(
      distinctId: string,
      properties: Properties,
      modifiers?: Modifiers,
      callback?: Callback,
    ): void;
  }

  export interface Mixpanel {
    track(eventName: string, properties: Properties, callback?: Callback): void;
    people: People;
  }

  export function init(token: string, config?: InitConfig): Mixpanel;

  const _default: { init: typeof init };
  export default _default;
}
