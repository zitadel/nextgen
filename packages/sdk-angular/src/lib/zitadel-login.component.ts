import { Component, Input, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

import type { ZitadelProject } from './config';

// Registers <zitadel-login> / <zitadel-logout> with the browser.
import '@zitadel/components';

/**
 * Angular wrapper for the `<zitadel-login>` Lit web component.
 *
 * Uses a distinct selector (`zitadel-auth-login`) and renders the real custom
 * element in its template under `CUSTOM_ELEMENTS_SCHEMA`. The `project` handle
 * (from `configureZitadel(...)`) is bound as a DOM **property** via `[project]`;
 * `purpose` / `post-sign-in-url` are bound as attributes the Lit element reads.
 *
 * ```html
 * <zitadel-auth-login [project]="project" purpose="login" postSignInUrl="/" />
 * ```
 */
@Component({
  selector: 'zitadel-auth-login',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-login
    [project]="project"
    [attr.purpose]="purpose"
    [attr.post-sign-in-url]="postSignInUrl"
  ></zitadel-login>`,
})
export class ZitadelLoginComponent {
  @Input() project?: ZitadelProject;
  @Input() purpose = 'login';
  @Input() postSignInUrl?: string;
}
