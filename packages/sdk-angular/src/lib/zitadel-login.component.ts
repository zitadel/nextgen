import type { ElementRef } from "@angular/core";
import type { ZitadelLogin as ZitadelLoginElement } from "@zitadel/components";
import type {
  ZitadelFlowPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
} from "@zitadel/sdk-core/types";

import { Component, CUSTOM_ELEMENTS_SCHEMA, input, output, viewChild } from "@angular/core";

import type { ZitadelProject } from "@zitadel/sdk-core/config";

// Registers <zitadel-login> / <zitadel-logout> with the browser.
import "@zitadel/components";

/**
 * Renders the Zitadel sign-in, registration and other flows inside an Angular template.
 *
 * The component wraps the `<zitadel-login>` widget so that you bind inputs and outputs the Angular
 * way instead of driving a custom element by hand. It has the selector `zitadel-auth-login`, not
 * the element name, and renders the real element in its template under `CUSTOM_ELEMENTS_SCHEMA`.
 * Use it on the page that signs a user in. To show who is signed in or to sign out, use {@link
 * ZitadelSession} or {@link ZitadelLogout}.
 *
 * The {@link ZitadelLogin.project | project} handle is bound as a DOM property. The
 * discrete project id and same-origin proxy path are bound as properties too, and again as the
 * `project-id` and `proxy-path` attributes, so a server-rendered page carries them before
 * hydration. The handle wins over the discrete inputs, as it does inside the widget. Callbacks,
 * `locales` and the boolean options are properties and are not part of server markup. The widget
 * fires `zitadel-*` events, and the component re-emits each detail on the outputs {@link
 * ZitadelLogin.flowStep}, {@link ZitadelLogin.flowInput}, {@link
 * ZitadelLogin.flowComplete}, {@link ZitadelLogin.flowRedirect} and {@link
 * ZitadelLogin.flowError}.
 *
 * The widget is defined only in a browser. On the server the tag renders as an unknown element
 * until the browser upgrades it, so mount the component on the client after hydration. A widget
 * that starts before its configuration arrives shows an error instead of the flow.
 *
 * Every input is a signal input declared with `input()`, and every event is an output declared with
 * `output()`, so the component needs Angular 19 or later. Templates bind them as they bind any
 * input and output. The inputs are exactly the keys of {@link ZitadelLoginProps}.
 *
 * The underlying custom element is reachable through {@link ZitadelLogin.element}, the
 * Angular counterpart of a React ref.
 *
 * @example
 * ```html
 * <zitadel-auth-login
 *   [project]="project"
 *   purpose="login"
 *   postSignInUrl="/"
 *   (flowComplete)="onComplete($event)"
 * />
 * ```
 *
 * @see {@link configureZitadel}
 */
@Component({
  selector: "zitadel-auth-login",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-login
    #el
    [project]="project()"
    [projectId]="projectId()"
    [proxyPath]="proxyPath()"
    [attr.project-id]="project()?.projectId ?? projectId() ?? null"
    [attr.proxy-path]="project()?.proxyPath ?? proxyPath() ?? null"
    [attr.url]="project()?.url ?? null"
    [locales]="locales()"
    [attr.lang]="lang() ?? null"
    [attr.purpose]="purpose()"
    [attr.flow-name]="flowName()"
    [attr.post-sign-in-url]="postSignInUrl()"
    [forcePostSignInUrl]="forcePostSignInUrl()"
    [attr.resume-flow-id]="resumeFlowId()"
    [attr.variant]="variant() ?? null"
    [attr.theme]="theme() ?? null"
    [suppressHeader]="suppressHeader()"
    [suppressPasswordToggle]="suppressPasswordToggle()"
    (zitadel-flow-step)="onFlowStep($event)"
    (zitadel-flow-input)="onFlowInput($event)"
    (zitadel-flow-complete)="onFlowComplete($event)"
    (zitadel-flow-redirect)="onFlowRedirect($event)"
    (zitadel-flow-error)="onFlowError($event)"
  ></zitadel-login>`,
})
export class ZitadelLogin {
  /**
   * The project handle that tells the widget which project to talk to.
   *
   * Create it once with {@link configureZitadel} and pass it here. When set, it wins over {@link
   * ZitadelLogin.projectId} and {@link ZitadelLogin.proxyPath}, as it does inside
   * the widget. It is bound as a DOM property, and its project id, proxy path and `url` are also
   * written as the `project-id`, `proxy-path` and `url` attributes, so server-rendered markup
   * carries them before hydration. Unset, the widget falls back to the discrete inputs and then to
   * the globally registered project.
   *
   * @example
   * ```html
   * <zitadel-auth-login [project]="project" />
   * ```
   */
  readonly project = input<ZitadelProject>();
  /**
   * The id of the project the widget works with.
   *
   * Use it when you do not have a project handle. It is read only when {@link
   * ZitadelLogin.project} is unset, and it is written as the `project-id` attribute so it
   * survives server rendering. Unset, the widget falls back to the globally registered project.
   *
   * @example
   * ```html
   * <zitadel-auth-login projectId="123456789" />
   * ```
   */
  readonly projectId = input<string>();
  /**
   * The same-origin proxy path the widget calls instead of the Zitadel API directly.
   *
   * The widget requests `${proxyPath}/...` on your app's own origin, so the browser never calls
   * Zitadel across origins and no credentials leave your origin. It is read only when {@link
   * ZitadelLogin.project} is unset, and it is written as the `proxy-path` attribute. Your
   * hosting platform must route this path to Zitadel.
   *
   * @defaultValue "/__nextgen"
   *
   * @example
   * ```html
   * <zitadel-auth-login proxyPath="/auth-proxy" />
   * ```
   */
  readonly proxyPath = input<string>();
  /**
   * The kind of flow the widget starts.
   *
   * Use `"login"` on a sign-in page and the registration purpose on a sign-up page. It is ignored
   * when {@link ZitadelLogin.resumeFlowId} resolves to an existing flow. It is written as
   * the `purpose` attribute.
   *
   * @defaultValue "login"
   *
   * @example
   * ```html
   * <zitadel-auth-login purpose="register" />
   * ```
   */
  readonly purpose = input<ZitadelFlowPurpose | undefined>("login");
  /**
   * The name of the flow definition to run.
   *
   * Unset runs the project's default flow for {@link ZitadelLogin.purpose}. Set it to run
   * a named flow that you configured for a product line or a tenant. It is written as the
   * `flow-name` attribute.
   *
   * @example
   * ```html
   * <zitadel-auth-login flowName="partner-login" />
   * ```
   */
  readonly flowName = input<string>();
  /**
   * The URL the widget navigates to after a completed sign-in.
   *
   * When the page's `next` query parameter names a path on the same origin, as the server SDKs'
   * middleware sets it for a signed-out visit to a protected route, the widget returns there
   * instead, unless {@link ZitadelLogin.forcePostSignInUrl} is set. A `next` value is
   * followed only when it is a path on the page's own origin. A full URL, a protocol-relative
   * `//host` value, or one with a backslash or control character is refused and the widget falls
   * back to this URL, so the parameter cannot turn the login page into an open redirect. A sign-in
   * through an identity provider keeps `next`. Unset leaves navigation to your {@link
   * ZitadelLogin.flowComplete} handler. It is written as the `post-sign-in-url` attribute.
   *
   * @example
   * ```html
   * <zitadel-auth-login postSignInUrl="/dashboard" />
   * ```
   */
  readonly postSignInUrl = input<string>();
  /**
   * Whether the widget always navigates to {@link ZitadelLogin.postSignInUrl}, even when
   * the page's `next` query parameter names a path.
   *
   * Set it on a page that uses `next` for something of its own. It is bound as a DOM property, so
   * it is not part of server markup.
   *
   * @defaultValue false
   *
   * @example
   * ```html
   * <zitadel-auth-login postSignInUrl="/home" [forcePostSignInUrl]="true" />
   * ```
   */
  readonly forcePostSignInUrl = input<boolean>();
  /**
   * The id of an existing flow to resume instead of starting a new one.
   *
   * Use it to continue a flow from an email link or a stored id. Unset, `null` or `""` falls back
   * to the `flow` query parameter of the page, and an id that no longer resolves starts a new flow.
   * It is written as the `resume-flow-id` attribute, so a server-rendered page resumes the same
   * flow on hydration.
   *
   * @example
   * ```html
   * <zitadel-auth-login [resumeFlowId]="flowId" />
   * ```
   */
  readonly resumeFlowId = input<string | null>();
  /**
   * Copy overrides merged over the built-in dictionaries, keyed by primary language subtag.
   *
   * Use it to change a label, or to supply the business copy overlay `businessLocales` that this
   * package re-exports. It is bound as a DOM property, so it is not part of server markup and the
   * widget shows the built-in copy until the browser upgrades it. Unset keeps the built-in copy.
   *
   * @example
   * ```ts
   * locales = { en: { "identifier.title": "Welcome back" } };
   * ```
   */
  readonly locales = input<Record<string, Partial<Record<string, string>>>>();
  /**
   * The BCP 47 language the widget renders in.
   *
   * Unset omits the `lang` attribute, so the widget uses the browser language. It is written as an
   * attribute, so server-rendered markup carries it.
   *
   * @example
   * ```html
   * <zitadel-auth-login lang="de" />
   * ```
   */
  readonly lang = input<string>();
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
   * <zitadel-auth-login variant="page" />
   * ```
   */
  readonly variant = input<"widget" | "page">();
  /**
   * The colour mode of the widget.
   *
   * Use `"auto"` to follow the operating system through `prefers-color-scheme`, or `"light"` or
   * `"dark"` to pin one mode. Unset omits the `theme` attribute, so the widget follows the
   * tenant's branding theme and then the variant default, which is `"dark"` for the `"page"`
   * variant and `"auto"` for the `"widget"` variant.
   *
   * @example
   * ```html
   * <zitadel-auth-login theme="dark" />
   * ```
   */
  readonly theme = input<"light" | "dark" | "auto">();
  /**
   * Whether the widget hides its own heading block.
   *
   * The heading stays in the accessibility tree and is only hidden visually, so use it on a page
   * that already carries its own heading. Unset is the same as `false` and keeps the heading
   * visible.
   *
   * @defaultValue false
   *
   * @example
   * ```html
   * <zitadel-auth-login [suppressHeader]="true" />
   * ```
   */
  readonly suppressHeader = input<boolean>();
  /**
   * Whether the widget hides the show and hide button on password fields.
   *
   * The widget shows the button by default, and it sits in the tab order right after the field. The
   * option is named negatively because a boolean attribute can only switch something on. The
   * setting belongs to the embedding page and is not stored with the tenant's branding. Unset keeps
   * the button.
   *
   * @defaultValue false
   *
   * @example
   * ```html
   * <zitadel-auth-login [suppressPasswordToggle]="true" />
   * ```
   */
  readonly suppressPasswordToggle = input<boolean>();
  /**
   * Emits the `zitadel-flow-step` detail each time the widget shows a step, the first one included.
   *
   * Use it to track progress through a flow, for analytics or a step indicator.
   *
   * @example
   * ```html
   * <zitadel-auth-login (flowStep)="onStep($event)" />
   * ```
   */
  readonly flowStep = output<ZitadelFlowStepDetail>();
  /**
   * Emits the `zitadel-flow-input` detail when the visitor edits a field.
   *
   * The detail carries the field name and its new value exactly as typed. The event fires for every
   * field of a step, including the password field, where the value is the plain-text password, so
   * never log or store it. The widget still owns the form: the listener cannot change or cancel the
   * edit.
   *
   * @example
   * ```html
   * <zitadel-auth-login (flowInput)="onInput($event)" />
   * ```
   */
  readonly flowInput = output<ZitadelFlowInputDetail>();
  /**
   * Emits the `zitadel-flow-complete` detail when the flow reaches a terminal step.
   *
   * Use it to start your own session or to navigate. The detail carries `waitUntil(promise)`: call
   * it to make the widget wait for your asynchronous work before it navigates to {@link
   * ZitadelLogin.postSignInUrl}.
   *
   * @example
   * ```html
   * <zitadel-auth-login (flowComplete)="onComplete($event)" />
   * ```
   */
  readonly flowComplete = output<ZitadelFlowCompleteDetail>();

  /**
   * Emits the `zitadel-flow-redirect` detail when the widget hands the browser to an identity
   * provider.
   *
   * Nobody is signed in yet at this point. The detail carries `waitUntil(promise)`: call it to
   * delay the navigation.
   *
   * @example
   * ```html
   * <zitadel-auth-login (flowRedirect)="onRedirect($event)" />
   * ```
   */
  readonly flowRedirect = output<ZitadelFlowRedirectDetail>();
  /**
   * Emits the `zitadel-flow-error` detail when the flow reports an error.
   *
   * Use it to log failures or to show your own message next to the widget.
   *
   * @example
   * ```html
   * <zitadel-auth-login (flowError)="onError($event)" />
   * ```
   */
  readonly flowError = output<ZitadelFlowErrorDetail>();

  private readonly elementRef = viewChild<ElementRef<ZitadelLoginElement>>("el");

  /**
   * The underlying `<zitadel-login>` custom element, or `null` before the view is initialized.
   *
   * Use it for what the inputs do not cover, such as calling a method on the element or attaching
   * an extra listener. It is `null` until Angular has rendered the template.
   */
  get element(): ZitadelLoginElement | null {
    return this.elementRef()?.nativeElement ?? null;
  }

  /**
   * Re-emits a `zitadel-flow-step` DOM event's detail on {@link ZitadelLogin.flowStep}.
   *
   * The template calls it, so you do not. It is public only because Angular templates read it.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowStep(event: Event): void {
    if (event instanceof CustomEvent) {
      this.flowStep.emit(event.detail);
    }
  }

  /**
   * Re-emits a `zitadel-flow-input` DOM event's detail on {@link ZitadelLogin.flowInput}.
   *
   * The template calls it, so you do not. It is public only because Angular templates read it.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowInput(event: Event): void {
    if (event instanceof CustomEvent) {
      this.flowInput.emit(event.detail);
    }
  }

  /**
   * Re-emits a `zitadel-flow-complete` DOM event's detail on {@link
   * ZitadelLogin.flowComplete}.
   *
   * The template calls it, so you do not. It is public only because Angular templates read it.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowComplete(event: Event): void {
    if (event instanceof CustomEvent) {
      this.flowComplete.emit(event.detail);
    }
  }

  /**
   * Re-emits a `zitadel-flow-redirect` DOM event's detail on {@link
   * ZitadelLogin.flowRedirect}.
   *
   * The template calls it, so you do not. It is public only because Angular templates read it.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowRedirect(event: Event): void {
    if (event instanceof CustomEvent) {
      this.flowRedirect.emit(event.detail);
    }
  }

  /**
   * Re-emits a `zitadel-flow-error` DOM event's detail on {@link ZitadelLogin.flowError}.
   *
   * The template calls it, so you do not. It is public only because Angular templates read it.
   *
   * @param event - The DOM event; anything that is not a `CustomEvent` is ignored.
   */
  onFlowError(event: Event): void {
    if (event instanceof CustomEvent) {
      this.flowError.emit(event.detail);
    }
  }
}
