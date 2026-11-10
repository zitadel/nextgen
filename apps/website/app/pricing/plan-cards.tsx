import { StatusTag } from "./compare-table";
import {
  CLOUD_ONLY,
  Feature,
  flexFor,
  PRIMARY,
  SECONDARY,
  SELF_HOSTED_ID,
  SELF_HOSTED_ONLY,
} from "./parts";
import type { PlanCard, PlanHead, PlanList } from "./plans";

const OPTION =
  "relative flex h-9 cursor-pointer items-center rounded-full px-5 font-semibold text-sm text-text-secondary transition-colors has-[:checked]:bg-text-primary has-[:checked]:text-background has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-text-accent";

/**
 * Where Zitadel runs: two radios, so the choice needs no script. Everything
 * inside the page's `group/deploy` can show for one of them only
 * (deployment.ts).
 */
export function DeploymentSwitch() {
  return (
    <div
      role="radiogroup"
      aria-label="Where Zitadel runs"
      className="inline-flex rounded-full border border-window-border bg-window p-1 shadow-(--window-shadow)"
    >
      <label className={OPTION}>
        <input type="radio" name="deployment" defaultChecked className="sr-only" />
        Cloud
      </label>
      <label className={OPTION}>
        <input type="radio" name="deployment" id={SELF_HOSTED_ID} className="sr-only" />
        Self-hosted
      </label>
    </div>
  );
}

/**
 * The offer's three steps as cards. They are the same cards wherever Zitadel
 * runs: the switch adds each card's list for self-hosting and swaps the few
 * lines and buttons that hold for one deployment only, and the first card's
 * name and price.
 */
export function PlanCards({ cards }: { cards: PlanCard[] }) {
  return (
    <div className="grid gap-4 text-left lg:grid-cols-3">
      {cards.map((card) => {
        // Everyone starts on the first card, so its button is the page's one primary action.
        const button = card.id === "free" ? PRIMARY : SECONDARY;
        const { cloud, self_hosted: own } = card.action;
        const same = cloud.label === own.label && cloud.href === own.href;
        return (
          <article
            key={card.id}
            className="flex flex-col rounded-2xl border border-window-border bg-window p-6 shadow-(--window-shadow) md:p-7"
          >
            {card.own ? (
              <>
                <div className={CLOUD_ONLY}>
                  <Head head={card} />
                </div>
                <div className={SELF_HOSTED_ONLY}>
                  <Head head={card.own} />
                </div>
              </>
            ) : (
              <Head head={card} />
            )}
            <div className={`mt-6 ${same ? "" : CLOUD_ONLY}`}>
              <a href={cloud.href} className={button}>
                {cloud.label}
              </a>
            </div>
            {!same && (
              <div className={`mt-6 ${SELF_HOSTED_ONLY}`}>
                <a href={own.href} className={button}>
                  {own.label}
                </a>
              </div>
            )}
            {card.lists.map((list) => (
              <List key={list.heading} list={list} />
            ))}
          </article>
        );
      })}
    </div>
  );
}

function Head({ head }: { head: PlanHead }) {
  return (
    <>
      <h2 className="font-heading text-2xl text-text-primary leading-tight">{head.name}</h2>
      <p className="mt-2 text-sm text-text-secondary leading-6 lg:min-h-12">{head.line}</p>
      <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-heading text-4xl text-text-primary leading-none tracking-[-0.02em]">
          {head.price}
        </span>
        <span className="text-sm text-text-muted">{head.per}</span>
      </p>
    </>
  );
}

function List({ list }: { list: PlanList }) {
  const only =
    list.only === "self_hosted" ? SELF_HOSTED_ONLY : list.only === "cloud" ? CLOUD_ONLY : "";
  return (
    <div className={`mt-7 border-border-primary border-t pt-6 ${only}`}>
      {/* What differs for one deployment stands out from what is the same in both. */}
      <h3
        className={`font-mono text-xs leading-4 ${list.only ? "text-text-accent" : "text-text-muted"}`}
      >
        {list.heading}
      </h3>
      {list.priced ? (
        <ul className="mt-4 flex flex-col gap-2.5 text-sm leading-6">
          {list.items.map((item) => (
            <li
              key={item.text}
              className={`${flexFor(item.only)} items-baseline justify-between gap-4`}
            >
              <span className={item.price ? "text-text-primary" : "text-text-secondary opacity-55"}>
                {item.text}
              </span>
              {item.price ? (
                <span className="shrink-0 whitespace-nowrap text-text-muted">
                  <span className="text-text-primary">{item.price}</span> {item.per}
                </span>
              ) : (
                item.status && <StatusTag status={item.status} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-4 flex flex-col gap-3 text-sm text-text-secondary leading-6">
          {list.items.map((item) => (
            <Feature key={item.text} text={item.text} status={item.status} only={item.only} />
          ))}
        </ul>
      )}
    </div>
  );
}
