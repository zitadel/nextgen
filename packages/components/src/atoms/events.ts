import type { ZlCheckboxChangeDetail } from "./zl-checkbox.js";
import type { ZlFieldInputDetail } from "./zl-field.js";
import type {
  ZlPasskeyErrorDetail,
  ZlPasskeyResultDetail,
  ZlPasskeyStartedDetail,
} from "./zl-passkey.js";
import type { ZlSelectChangeDetail } from "./zl-select.js";
import type { ZlSsoSelectDetail } from "./zl-sso-providers.js";

/** Detail of `zl-submit`: the flow action to run, `null` for a plain submit. */
export type ZlSubmitDetail = { action: string | null };

declare global {
  interface HTMLElementEventMap {
    "zl-submit": CustomEvent<ZlSubmitDetail>;
    "zl-input": CustomEvent<ZlFieldInputDetail>;
    "zl-change": CustomEvent<ZlCheckboxChangeDetail | ZlSelectChangeDetail>;
    "zl-dismiss": CustomEvent<null>;
    "zl-sso-select": CustomEvent<ZlSsoSelectDetail>;
    "zl-passkey-started": CustomEvent<ZlPasskeyStartedDetail>;
    "zl-passkey-result": CustomEvent<ZlPasskeyResultDetail>;
    "zl-passkey-error": CustomEvent<ZlPasskeyErrorDetail>;
  }
}
