import type { ZitadelSignoutDetail } from '@zitadel/sdk-core/types';

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

import type { ZitadelProject } from './config';

import '@zitadel/components';

/**
 * Angular wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLoginComponent} for the strategy. The widget's
 * `zitadel-signout` event is re-emitted with its detail as the `signout`
 * output.
 *
 * ```html
 * <zitadel-auth-logout [project]="project" postSignOutUrl="/login"
 *   (signout)="onSignout($event)" />
 * ```
 */
@Component({
  selector: 'zitadel-auth-logout',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-logout
    [project]="project"
    [projectId]="projectId"
    [proxyPath]="proxyPath"
    [attr.post-sign-out-url]="postSignOutUrl"
    (zitadel-signout)="onSignout($event)"
  ></zitadel-logout>`,
})
export class ZitadelLogoutComponent {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() postSignOutUrl?: string;
  @Output() signout = new EventEmitter<ZitadelSignoutDetail>();

  onSignout(event: Event): void {
    this.signout.emit((event as CustomEvent<ZitadelSignoutDetail>).detail);
  }
}
