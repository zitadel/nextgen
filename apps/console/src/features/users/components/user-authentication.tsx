import { passwordState } from "@/features/authentication/model";
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { formatDate, formatDateTime } from "@/lib/date";
import type { IdpConnection, UserIdentityLink } from "@/features/authentication/model";

// An authentication row: a muted label, its value on the right. 4px block
// padding, and 18px to the rule between rows (the list's `gap-4.5`).
const ROW = "flex items-center justify-between gap-4 py-1";
const ROW_LABEL = "text-muted-foreground min-w-0 truncate text-sm font-medium";
const ROW_VALUE = "text-foreground shrink-0 text-sm";

/** How the user signs in: their password, their passkeys, each linked provider account. */
export function UserAuthentication({
  passwordSetAt,
  passkeys,
  identityLinks,
  idps,
}: {
  /** `null`: the user has no password; `undefined`: it could not be read. */
  passwordSetAt: string | null | undefined;
  passkeys: { created_at: string }[] | undefined;
  identityLinks: UserIdentityLink[] | undefined;
  idps: IdpConnection[] | null;
}) {
  return (
    <AuthenticationRows
      rows={[
        { key: "password", label: "Password", value: passwordState(passwordSetAt) },
        { key: "passkey", label: "Passkey", value: passkeyState(passkeys) },
        ...identityLinkRows(identityLinks, idps),
      ]}
    />
  );
}

interface AuthenticationRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** A muted line under the row that explains its value. */
  note?: string;
}

/** The Authentication card's rows: a muted label, its value, a rule between each. */
function AuthenticationRows({ rows }: { rows: AuthenticationRow[] }) {
  return (
    <ul className="flex flex-col gap-4.5">
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 && (
            <li role="none">
              <Separator />
            </li>
          )}
          <li className={row.note ? `${ROW} flex-wrap` : ROW}>
            <span className={ROW_LABEL}>{row.label}</span>
            <span className={ROW_VALUE}>{row.value}</span>
            {row.note && (
              <span className="text-muted-foreground basis-full text-xs">{row.note}</span>
            )}
          </li>
        </Fragment>
      ))}
    </ul>
  );
}

/**
 * A passkey is stored once its registration's attestation verifies, so its
 * `created_at` is when it was verified.
 */
function passkeyState(passkeys: { created_at: string }[] | undefined): string {
  if (passkeys === undefined) return "Could not be loaded";
  if (passkeys.length === 0) return "Not set up";
  const latest = passkeys
    .map((passkey) => passkey.created_at)
    .sort()
    .at(-1) as string;
  return passkeys.length === 1
    ? `Verified ${formatDateTime(latest)}`
    : `${passkeys.length} registered, last verified ${formatDateTime(latest)}`;
}

/**
 * One row per provider account linked to the user. A link is written when a
 * sign-in through the connection resolves to this user, so these are the
 * providers the user actually signs in with — not the ones the schema merely
 * allows.
 */
function identityLinkRows(
  links: UserIdentityLink[] | undefined,
  idps: IdpConnection[] | null,
): AuthenticationRow[] {
  if (!links) {
    return [
      { key: "identity-providers", label: "Identity providers", value: "Could not be loaded" },
    ];
  }
  if (links.length === 0) {
    return [
      {
        key: "identity-providers",
        label: "Identity providers",
        value: "None linked",
        note: "Linking a provider to an existing account is not supported yet.",
      },
    ];
  }
  const byId = new Map((idps ?? []).map((idp) => [idp.id, idp]));
  return links.map((link) => {
    const idp = byId.get(link.connection_id);
    return {
      key: link.id,
      label: idp ? (
        <Link
          to="/authentication/idps/$idpId"
          params={{ idpId: idp.id }}
          className="hover:text-foreground hover:underline"
        >
          {idp.definition.display_name}
        </Link>
      ) : (
        // The connection list may be refused (`idp.read`); the id is still
        // the honest name for it.
        <span className="font-mono">{link.connection_id}</span>
      ),
      value: `Linked ${formatDate(link.created_at)}`,
    };
  });
}
