import type { ElementRef } from "@angular/core";
import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import {
  Component,
  computed,
  CUSTOM_ELEMENTS_SCHEMA,
  input,
  output,
  viewChild,
} from "@angular/core";

import type { ZitadelProject } from "@zitadel/sdk-core/config";

import "@zitadel/components";

/**
 * Renders the signed-in "signed in as" card with a sign-out action inside an Angular template.
 *
 * The component wraps the `<zitadel-session>` widget and has the selector `zitadel-auth-session`.
 * Use it after sign-in, on a page that shows who is signed in. The inputs and the server-render
 * behavior are the same as for {@link ZitadelLogin}. The widget fires `zitadel-signout`,
 * and the component re-emits its detail on {@link ZitadelSession.signout}. The underlying
 * element is reachable through {@link ZitadelSession.element}.
 *
 * A handler may return a promise, but the component emits an output and cannot capture a return
 * value, so nothing waits for it. To delay the navigation, call `waitUntil(promise)` on the
 * event detail inside the handler: the widget then waits for it, for at most two seconds, before
 * it navigates. Only the `signout` detail carries `waitUntil`.
 *
 * The standard HTML attributes (`class`, `style`, `id`, `data-*` and `aria-*`) belong to the
 * `zitadel-auth-session` host element, not to the widget inside it, so a host `id` or `class` lands on the host and
 * not on the `zitadel-session` element.
 *
 * Every input is a signal input declared with `input()`, and the event is an output declared with
 * `output()`, so the component needs Angular 19 or later. The inputs are exactly the keys of
 * {@link ZitadelSessionProps}.
 *
 * @example
 * ```html
 * <zitadel-auth-session [project]="project" postSignOutUrl="/login" (signout)="onSignout($event)"
 * />
 * ```
 */
@Component({
  selector: "zitadel-auth-session",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-session
    #el
    [project]="project()"
    [projectId]="projectId()"
    [proxyPath]="proxyPath() === '' ? '/' : proxyPath()"
    [attr.project-id]="project()?.projectId ?? projectId() ?? null"
    [attr.proxy-path]="proxyPathAttr()"
    [attr.url]="project()?.url ?? null"
    [attr.publishable-key]="project()?.publishableKey ?? null"
    [attr.post-sign-out-url]="postSignOutUrl() || null"
    [attr.heading]="heading()"
    [attr.logout-label]="logoutLabel()"
    [attr.variant]="variant() ?? null"
    [attr.theme]="theme() ?? null"
    [attr.suppress-header]="suppressHeader() ? '' : null"
    (zitadel-signout)="onSignout($event)"
  ></zitadel-session>`,
})
export class ZitadelSession {
  /**
   * The project handle that tells the widget which project to talk to.
   *
   * Create it once with {@link configureZitadel} and pass it here. When set, it wins over {@link
   * ZitadelSession.projectId} and {@link ZitadelSession.proxyPath}, as it does
   * inside the widget. It is bound as a DOM property, and its project id, proxy path and `url` are
   * also written as the `project-id`, `proxy-path` and `url` attributes, so server-rendered markup
   * carries them before hydration. Unset, the widget falls back to the discrete inputs and then to
   * the globally registered project.
   *
   * @example
   * ```html
   * <zitadel-auth-session [project]="project" />
   * ```
   */
  readonly project = input<ZitadelProject>();
  /**
   * The id of the project the widget works with.
   *
   * Use it when you do not have a project handle. It is read only when {@link
   * ZitadelSession.project} is unset, and it is written as the `project-id` attribute so
   * it survives server rendering. Unset, the widget falls back to the globally registered project.
   *
   * @example
   * ```html
   * <zitadel-auth-session projectId="123456789" />
   * ```
   */
  readonly projectId = input<string>();
  /**
   * The same-origin proxy path the widget calls instead of the Zitadel API directly.
   *
   * The widget requests `${proxyPath}/...` on your app's own origin, so the browser never calls
   * Zitadel across origins and no credentials leave your origin. It is read only when {@link
   * ZitadelSession.project} is unset, and it is written as the `proxy-path` attribute.
   * Your hosting platform must route this path to Zitadel.
   *
   * @defaultValue "/__nextgen"
   *
   * @example
   * ```html
   * <zitadel-auth-session proxyPath="/auth-proxy" />
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
   * <zitadel-auth-session postSignOutUrl="/login" />
   * ```
   */
  readonly postSignOutUrl = input<string>();
  /**
   * The heading text of the card.
   *
   * Unset keeps the widget's built-in heading, "Signed in as". It is written as the `heading`
   * attribute.
   *
   * @example
   * ```html
   * <zitadel-auth-session heading="Current account" />
   * ```
   */
  readonly heading = input<string>();
  /**
   * The label of the sign-out action.
   *
   * Unset keeps the widget's built-in label, "Sign out". It is written as the `logout-label`
   * attribute.
   *
   * @example
   * ```html
   * <zitadel-auth-session logoutLabel="Leave" />
   * ```
   */
  readonly logoutLabel = input<string>();
  /**
   * The surface variant of the widget.
   *
   * `"widget"` is content-sized and paints no page chrome, so it fits inside your own layout.
   * `"page"` claims the viewport, paints the surface background and loads the brand font, so it
   * suits a page that holds nothing else. Unset omits the `variant` attribute and the widget uses
   * its default.
   *
   * @defaultValue "widget"
   *
   * @example
   * ```html
   * <zitadel-auth-session variant="page" />
   * ```
   */
  readonly variant = input<"widget" | "page">();
  /**
   * The colour mode of the widget.
   *
   * Use `"auto"` to follow the operating system through `prefers-color-scheme`, or `"light"` or
   * `"dark"` to pin one mode. Unset omits the `theme` attribute and the widget decides from its own
   * defaults.
   *
   * @example
   * ```html
   * <zitadel-auth-session theme="dark" />
   * ```
   */
  readonly theme = input<"light" | "dark" | "auto">();
  /**
   * Whether the widget hides its own heading block.
   *
   * The heading stays in the accessibility tree and is only hidden visually, so use it on a page
   * that already carries its own heading. It is written as the `suppress-header` attribute, present
   * when `true` and absent otherwise. Unset keeps the heading visible.
   *
   * @defaultValue false
   *
   * @example
   * ```html
   * <zitadel-auth-session [suppressHeader]="true" />
   * ```
   */
  readonly suppressHeader = input<boolean>();
  /**
   * Emits the `zitadel-signout` detail when the user signs out.
   *
   * Use it to clear your own app state. The detail carries `waitUntil(promise)`: call it to make
   * the widget wait for your asynchronous work before it navigates to the post-sign-out URL.
   *
   * @example
   * ```html
   * <zitadel-auth-session (signout)="onSignout($event)" />
   * ```
   */
  readonly signout = output<ZitadelSignoutDetail>();

  /**
   * The value of the `proxy-path` attribute: the handle's path, else the discrete input.
   *
   * An empty path means the origin root, because the API client strips trailing slashes, but the
   * widget treats an empty `proxy-path` attribute as unset and falls back to `/__nextgen`. The
   * value `/` survives that and normalizes to the root. The template reads it, so you do not.
   */
  protected readonly proxyPathAttr = computed(() => {
    const path = this.project()?.proxyPath ?? this.proxyPath();
    return path === "" ? "/" : (path ?? null);
  });

  private readonly elementRef = viewChild<ElementRef<ZitadelSessionElement>>("el");

  /**
   * The underlying `<zitadel-session>` custom element, or `null` before the view is
   * initialized.
   *
   * Use it for what the inputs do not cover, such as calling a method on the element or attaching
   * an extra listener. It is `null` until Angular has rendered the template.
   */
  get element(): ZitadelSessionElement | null {
    return this.elementRef()?.nativeElement ?? null;
  }

  /**
   * Re-emits a `zitadel-signout` DOM event's detail on {@link ZitadelSession.signout}.
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
