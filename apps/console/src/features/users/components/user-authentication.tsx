import { passwordState } from "@/features/authentication/model";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DETAIL_VALUE, DetailRow, DetailRows } from "@/components/detail-page";
import { formatDate, formatDateTime } from "@/lib/date";
import type { IdpConnection, UserIdentityLink } from "@/features/authentication/model";

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
}

/** The Authentication card's rows: each method's label on the rail, its state beside it. */
function AuthenticationRows({ rows }: { rows: AuthenticationRow[] }) {
  return (
    <DetailRows as="ul">
      {rows.map((row) => (
        <DetailRow key={row.key} label={<span className="min-w-0 truncate">{row.label}</span>}>
          <span className={DETAIL_VALUE}>{row.value}</span>
        </DetailRow>
      ))}
    </DetailRows>
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
  if (!links?.length) {
    return [
      {
        key: "identity-providers",
        label: "Identity providers",
        value: links ? "None linked" : "Could not be loaded",
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
