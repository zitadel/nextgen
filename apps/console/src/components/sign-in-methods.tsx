import { Link } from "@tanstack/react-router";

import { formatDate } from "@/lib/date";
import type { IdpConnection, UserIdentityLink } from "@/lib/idp";
import type { Passkey } from "@/lib/passkeys";

// Long utility strings live as named constants so Tailwind's scanner sees the
// full literal (it never sees a concatenated fragment).
/** One sign-in method row: 24px in from the card edge, 16px down, 20px under. */
export const METHOD_ROW = "flex items-center justify-between gap-4 px-6 pt-4 pb-5";
/** A row's secondary text: counts, dates, and the states that stand in for them. */
export const METHOD_NOTE = "text-muted-foreground text-[13px] leading-[22px]";

/**
 * The provider accounts linked to a user, one row each. A link is written
 * when a sign-in through the connection resolves to this user, so these are
 * the providers the user actually signs in with — not the ones the schema
 * merely allows.
 *
 * A connection is named when `idps` holds it, and links to its page when
 * `linkIdps` is set; the person's own settings have no project to open it in.
 */
export function IdentityLinks({
  links,
  idps,
  empty,
  linkIdps = true,
}: {
  links: UserIdentityLink[] | undefined;
  idps: IdpConnection[] | null;
  empty: string;
  linkIdps?: boolean;
}) {
  if (!links?.length) {
    return (
      <p className={`${METHOD_NOTE} px-6 pt-4 pb-5`}>{links ? empty : "Could not be loaded"}</p>
    );
  }

  const byId = new Map((idps ?? []).map((idp) => [idp.id, idp]));
  return (
    <ul className="flex flex-col">
      {links.map((link) => {
        const idp = byId.get(link.connection_id);
        return (
          <li key={link.id} className={METHOD_ROW}>
            {idp && linkIdps ? (
              <Link
                to="/authentication/idps/$idpId"
                params={{ idpId: idp.id }}
                className="text-foreground text-sm font-medium hover:underline"
              >
                {idp.definition.display_name}
              </Link>
            ) : idp ? (
              <span className="text-foreground truncate text-sm font-medium">
                {idp.definition.display_name}
              </span>
            ) : (
              // The connection list may be refused (`idp.read`); the id is
              // still the honest name for it.
              <span className="text-foreground truncate font-mono text-sm">
                {link.connection_id}
              </span>
            )}
            <span className={`${METHOD_NOTE} shrink-0`}>Linked {formatDate(link.created_at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A user's passkeys, one row each: the name it was given and when it was added. */
export function Passkeys({ passkeys, empty }: { passkeys: Passkey[] | undefined; empty: string }) {
  if (!passkeys?.length) {
    return (
      <p className={`${METHOD_NOTE} px-6 pt-4 pb-5`}>{passkeys ? empty : "Could not be loaded"}</p>
    );
  }
  return (
    <ul className="flex flex-col">
      {passkeys.map((passkey) => (
        <li key={passkey.id} className={METHOD_ROW}>
          <span className="text-foreground truncate text-sm font-medium">{passkey.name}</span>
          <span className={`${METHOD_NOTE} shrink-0`}>Added {formatDate(passkey.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
