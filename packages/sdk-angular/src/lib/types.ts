import type {
  ZitadelLoginConfig,
  ZitadelLogoutConfig,
  ZitadelSessionConfig,
} from "@zitadel/sdk-core/types";

/**
 * The inputs of the {@link ZitadelLogin} component, spelled as the shared widget configuration.
 *
 * It is the same type as the configuration of the `<zitadel-login>` widget that every SDK of the
 * package family shares, and nothing more. It describes only what you bind on the component tag,
 * because an Angular component has no callback props: the widget's events are outputs, not
 * properties of this type. The outputs are `flowStep`, `flowInput`, `flowComplete`,
 * `flowRedirect` and `flowError`, and each emits the detail of the matching `zitadel-flow-*`
 * event, including its `waitUntil(promise)` where the detail carries one. A unit test fails when
 * the signal inputs of the component and the keys of this type differ.
 *
 * Use it to type a value that you spread onto several tags or pass between components. Do not use
 * it to type handlers: bind those with `(flowComplete)="..."` in the template.
 *
 * @example
 * ```ts
 * import { Component } from "@angular/core";
 * import { ZitadelLogin, type ZitadelLoginProps } from "@zitadel/sdk-angular";
 *
 * @Component({
 *   standalone: true,
 *   imports: [ZitadelLogin],
 *   template: `<zitadel-auth-login
 *     [project]="options.project"
 *     [variant]="options.variant"
 *     (flowComplete)="onComplete($event)"
 *   />`,
 * })
 * export class LoginPage {
 *   readonly options: ZitadelLoginProps = { variant: "page", theme: "light" };
 * }
 * ```
 */
export type ZitadelLoginProps = ZitadelLoginConfig;

/**
 * The inputs of the {@link ZitadelLogout} component, spelled as the shared widget configuration.
 *
 * It is the same type as the configuration of the `<zitadel-logout>` widget that every SDK of the
 * package family shares, and nothing more. It describes only what you bind on the component tag,
 * because an Angular component has no callback props: the widget's event is the output `signout`,
 * which emits the `zitadel-signout` detail, including its `waitUntil(promise)`. A unit test fails
 * when the signal inputs of the component and the keys of this type differ.
 *
 * Use it to type a value that you pass between components. Do not use it to type the handler:
 * bind that with `(signout)="..."` in the template.
 *
 * @example
 * ```ts
 * import { Component } from "@angular/core";
 * import { ZitadelLogout, type ZitadelLogoutProps } from "@zitadel/sdk-angular";
 *
 * @Component({
 *   standalone: true,
 *   imports: [ZitadelLogout],
 *   template: `<zitadel-auth-logout
 *     [postSignOutUrl]="options.postSignOutUrl"
 *     (signout)="onSignout($event)"
 *   />`,
 * })
 * export class Header {
 *   readonly options: ZitadelLogoutProps = { postSignOutUrl: "/login" };
 * }
 * ```
 */
export type ZitadelLogoutProps = ZitadelLogoutConfig;

/**
 * The inputs of the {@link ZitadelSession} component, spelled as the shared widget configuration.
 *
 * It is the same type as the configuration of the `<zitadel-session>` widget that every SDK of the
 * package family shares, and nothing more. It describes only what you bind on the component tag,
 * because an Angular component has no callback props: the widget's event is the output `signout`,
 * which emits the `zitadel-signout` detail, including its `waitUntil(promise)`. A unit test fails
 * when the signal inputs of the component and the keys of this type differ.
 *
 * Use it to type a value that you pass between components. Do not use it to type the handler:
 * bind that with `(signout)="..."` in the template.
 *
 * @example
 * ```ts
 * import { Component } from "@angular/core";
 * import { ZitadelSession, type ZitadelSessionProps } from "@zitadel/sdk-angular";
 *
 * @Component({
 *   standalone: true,
 *   imports: [ZitadelSession],
 *   template: `<zitadel-auth-session
 *     [heading]="options.heading"
 *     (signout)="onSignout($event)"
 *   />`,
 * })
 * export class Account {
 *   readonly options: ZitadelSessionProps = { heading: "Current account" };
 * }
 * ```
 */
export type ZitadelSessionProps = ZitadelSessionConfig;
