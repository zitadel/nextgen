import type {
  CreateFlowBodyPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
} from '@zitadel/sdk-core/types';

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

import type { ZitadelProject } from './config';

// Registers <zitadel-login> / <zitadel-logout> with the browser.
import '@zitadel/components';

/**
 * Angular wrapper for the `<zitadel-login>` Lit web component.
 *
 * Uses a distinct selector (`zitadel-auth-login`) and renders the real custom
 * element in its template under `CUSTOM_ELEMENTS_SCHEMA`. The `project` handle
 * (from `configureZitadel(...)`) is bound as a DOM **property** via `[project]`,
 * as are the discrete `projectId` / `proxyPath` the element reads when no handle
 * is supplied; `purpose` / `post-sign-in-url` are bound as attributes the Lit
 * element reads. The widget's `zitadel-*` events are re-emitted with their
 * detail as the `flowStep` / `flowInput` / `flowComplete` / `flowError` outputs.
 *
 * ```html
 * <zitadel-auth-login [project]="project" purpose="login" postSignInUrl="/"
 *   (flowComplete)="onComplete($event)" />
 * ```
 */
@Component({
  selector: 'zitadel-auth-login',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-login
    [project]="project"
    [projectId]="projectId"
    [proxyPath]="proxyPath"
    [attr.purpose]="purpose"
    [attr.post-sign-in-url]="postSignInUrl"
    (zitadel-flow-step)="onFlowStep($event)"
    (zitadel-flow-input)="onFlowInput($event)"
    (zitadel-flow-complete)="onFlowComplete($event)"
    (zitadel-flow-error)="onFlowError($event)"
  ></zitadel-login>`,
})
export class ZitadelLoginComponent {
  @Input() project?: ZitadelProject;
  @Input() projectId?: string;
  @Input() proxyPath?: string;
  @Input() purpose: CreateFlowBodyPurpose = 'login';
  @Input() postSignInUrl?: string;
  @Output() flowStep = new EventEmitter<ZitadelFlowStepDetail>();
  @Output() flowInput = new EventEmitter<ZitadelFlowInputDetail>();
  @Output() flowComplete = new EventEmitter<ZitadelFlowCompleteDetail>();
  @Output() flowError = new EventEmitter<ZitadelFlowErrorDetail>();

  onFlowStep(event: Event): void {
    this.flowStep.emit((event as CustomEvent<ZitadelFlowStepDetail>).detail);
  }

  onFlowInput(event: Event): void {
    this.flowInput.emit((event as CustomEvent<ZitadelFlowInputDetail>).detail);
  }

  onFlowComplete(event: Event): void {
    this.flowComplete.emit(
      (event as CustomEvent<ZitadelFlowCompleteDetail>).detail,
    );
  }

  onFlowError(event: Event): void {
    this.flowError.emit((event as CustomEvent<ZitadelFlowErrorDetail>).detail);
  }
}
