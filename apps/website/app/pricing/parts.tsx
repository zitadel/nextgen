import { StatusTag } from "./compare-table";
import { type FeatureStatus, featureStatus, works } from "./status";

// What the pricing page's sections share: its heading and button styles, the
// check and plus marks, a feature line, and the classes that show a block for
// one deployment only.

export const H2 =
  "font-heading text-3xl text-text-primary leading-tight tracking-[-0.02em] md:text-4xl";
const BUTTON =
  "flex h-11 items-center justify-center rounded-lg px-5 font-semibold text-sm transition-colors";
export const PRIMARY = `${BUTTON} bg-text-primary text-background hover:opacity-85`;
export const SECONDARY = `${BUTTON} border border-window-border bg-tint/[0.03] text-text-primary hover:bg-tint/[0.07]`;
export const LINK = "text-text-primary underline underline-offset-4";

/** The id of the switch's Self-hosted radio, which the classes below select on. */
export const SELF_HOSTED_ID = "deploy-self-hosted";
/**
 * A block for one deployment only. The switch is two radios inside the page's
 * `group/deploy`, so the choice needs no script and the page stays prerendered.
 */
export const CLOUD_ONLY = "group-has-[#deploy-self-hosted:checked]/deploy:hidden";
export const SELF_HOSTED_ONLY = "hidden group-has-[#deploy-self-hosted:checked]/deploy:block";

/** A feature with a check, greyed out with its tag while it doesn't work yet. */
export function Feature({ text, status = "available" }: { text: string; status?: FeatureStatus }) {
  return (
    <li className="flex gap-3">
      <span className={works(status) ? undefined : "opacity-55"}>
        <Check />
      </span>
      <span>
        <span className={works(status) ? undefined : "opacity-55"}>{text}</span>
        {status !== "available" && (
          <span className="ml-2 align-middle">
            <StatusTag status={status} />
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * An add-on's features, by what works today: those that do, each with a
 * check, then the others in one line per status, so a list of them is not
 * a column of tags.
 */
export function Features({ labels, columns = false }: { labels: string[]; columns?: boolean }) {
  const working = labels.filter((label) => works(featureStatus(label)));
  const later = (["next", "roadmap"] as const)
    .map((status) => ({
      status,
      labels: labels.filter((label) => featureStatus(label) === status),
    }))
    .filter((group) => group.labels.length > 0);
  return (
    <div className="flex flex-col gap-4 text-sm leading-6">
      {working.length > 0 && (
        <ul
          className={`text-text-secondary ${columns ? "grid gap-x-8 gap-y-2 sm:grid-cols-2" : "flex flex-col gap-2"}`}
        >
          {working.map((label) => (
            <Feature key={label} text={label} status={featureStatus(label)} />
          ))}
        </ul>
      )}
      {later.map((group) => (
        <p key={group.status} className="text-text-muted">
          <span className="mr-2 align-middle">
            <StatusTag status={group.status} />
          </span>
          {group.labels.join(" · ")}
        </p>
      ))}
    </div>
  );
}

export function Check() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="mt-1 size-4 shrink-0 text-success"
    >
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The mark on a row that opens: a plus that turns into a cross inside an open `group`. */
export function Plus() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-45"
    >
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
