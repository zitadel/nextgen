import type { ElementRef } from "@angular/core";
import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { Component, CUSTOM_ELEMENTS_SCHEMA, input, output, viewChild } from "@angular/core";

import type { ZitadelProject } from "@zitadel/sdk-core/config";

import "@zitadel/components";

/**
 * Renders the sign-out widget inside an Angular template.
 *
 * The component wraps the `<zitadel-logout>` widget and has the selector `zitadel-auth-logout`. Use
 * it where a user ends their session. The inputs and the server-render behavior are the same as for
 * {@link ZitadelLogin}. The widget fires `zitadel-signout`, and the component re-emits its
 * detail on {@link ZitadelLogout.signout}. The underlying element is reachable through
 * {@link ZitadelLogout.element}.
 *
 * Every input is a signal input declared with `input()`, and the event is an output declared with
 * `output()`, so the component needs Angular 19 or later. The inputs are exactly the keys of
 * {@link ZitadelLogoutProps}.
 *
 * @example
 * ```html
 * <zitadel-auth-logout [project]="project" postSignOutUrl="/login" (signout)="onSignout($event)" />
 * ```
 */
@Component({
  selector: "zitadel-auth-logout",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-logout
    #el
    [project]="project()"
    [projectId]="projectId()"
    [proxyPath]="proxyPath()"
    [attr.project-id]="project()?.projectId ?? projectId() ?? null"
    [attr.proxy-path]="project()?.proxyPath ?? proxyPath() ?? null"
    [attr.url]="project()?.url ?? null"
    [attr.post-sign-out-url]="postSignOutUrl()"
    [attr.theme]="theme() ?? null"
    (zitadel-signout)="onSignout($event)"
  ></zitadel-logout>`,
})
export class ZitadelLogout {
  /**
   * The project handle that tells the widget which project to talk to.
   *
   * Create it once with {@link configureZitadel} and pass it here. When set, it wins over {@link
   * ZitadelLogout.projectId} and {@link ZitadelLogout.proxyPath}, as it does
   * inside the widget. It is bound as a DOM property, and its project id, proxy path and `url` are
   * also written as the `project-id`, `proxy-path` and `url` attributes, so server-rendered markup
   * carries them before hydration. Unset, the widget falls back to the discrete inputs and then to
   * the globally registered project.
   *
   * @example
   * ```html
   * <zitadel-auth-logout [project]="project" />
   * ```
   */
  readonly project = input<ZitadelProject>();
  /**
   * The id of the project the widget works with.
   *
   * Use it when you do not have a project handle. It is read only when {@link
   * ZitadelLogout.project} is unset, and it is written as the `project-id` attribute so it
   * survives server rendering. Unset, the widget falls back to the globally registered project.
   *
   * @example
   * ```html
   * <zitadel-auth-logout projectId="123456789" />
   * ```
   */
  readonly projectId = input<string>();
  /**
   * The same-origin proxy path the widget calls instead of the Zitadel API directly.
   *
   * The widget requests `${proxyPath}/...` on your app's own origin, so the browser never calls
   * Zitadel across origins and no credentials leave your origin. It is read only when {@link
   * ZitadelLogout.project} is unset, and it is written as the `proxy-path` attribute. Your
   * hosting platform must route this path to Zitadel.
   *
   * @defaultValue "/__nextgen"
   *
   * @example
   * ```html
   * <zitadel-auth-logout proxyPath="/auth-proxy" />
   * ```
   */
  readonly proxyPath = input<string>();
  /**
   * The URL the widget navigates to after sign-out.
   *
   * Unset leaves navigation to your `signout` handler, so use it when the destination is static.
   * Navigation waits for any promise registered through `waitUntil` on the event detail. It is
   * written as the `post-sign-out-url` attribute.
   *
   * @example
   * ```html
   * <zitadel-auth-logout postSignOutUrl="/login" />
   * ```
   */
  readonly postSignOutUrl = input<string>();
  /**
   * The colour mode of the widget.
   *
   * Use `"auto"` to follow the operating system through `prefers-color-scheme`, or `"light"` or
   * `"dark"` to pin one mode. Unset omits the `theme` attribute and the widget uses `"auto"`.
   *
   * @example
   * ```html
   * <zitadel-auth-logout theme="dark" />
   * ```
   */
  readonly theme = input<"light" | "dark" | "auto">();
  /**
   * Emits the `zitadel-signout` detail when the user signs out.
   *
   * Use it to clear your own app state. The detail carries `waitUntil(promise)`: call it to make
   * the widget wait for your asynchronous work before it navigates to the post-sign-out URL.
   *
   * @example
   * ```html
   * <zitadel-auth-logout (signout)="onSignout($event)" />
   * ```
   */
  readonly signout = output<ZitadelSignoutDetail>();

  private readonly elementRef = viewChild<ElementRef<ZitadelLogoutElement>>("el");

  /**
   * The underlying `<zitadel-logout>` custom element, or `null` before the view is
   * initialized.
   *
   * Use it for what the inputs do not cover, such as calling a method on the element or attaching
   * an extra listener. It is `null` until Angular has rendered the template.
   */
  get element(): ZitadelLogoutElement | null {
    return this.elementRef()?.nativeElement ?? null;
  }

  /**
   * Re-emits a `zitadel-signout` DOM event's detail on {@link ZitadelLogout.signout}.
   *
   * The template calls it, so you do not. It is public only because Angular templates read it.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onSignout(event: Event): void {
    if (event instanceof CustomEvent) {
      this.signout.emit(event.detail);
    }
  }
}
