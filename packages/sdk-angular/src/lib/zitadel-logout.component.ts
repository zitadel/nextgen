import { Component, Input, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

import type { ZitadelProject } from './config';

import '@zitadel/components';

/**
 * Angular wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLoginComponent} for the strategy.
 *
 * ```html
 * <zitadel-auth-logout [project]="project" postSignOutUrl="/login" />
 * ```
 */
@Component({
  selector: 'zitadel-auth-logout',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-logout
    [project]="project"
    [attr.post-sign-out-url]="postSignOutUrl"
  ></zitadel-logout>`,
})
export class ZitadelLogoutComponent {
  @Input() project?: ZitadelProject;
  @Input() postSignOutUrl?: string;
}
