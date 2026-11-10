import { StatusTag } from "./compare-table";
import { CLOUD_ONLY, Feature, PRIMARY, SECONDARY, SELF_HOSTED_ID, SELF_HOSTED_ONLY } from "./parts";
import type { Deployment, PlanCard, PlanList } from "./plans";

const OPTION =
  "relative flex h-9 cursor-pointer items-center rounded-full px-5 font-semibold text-sm text-text-secondary transition-colors has-[:checked]:bg-text-primary has-[:checked]:text-background has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-text-accent";

/**
 * Where Zitadel runs: two radios, so the choice needs no script. Everything
 * inside the page's `group/deploy` can show for one of them only (parts.tsx).
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

/** The offer's three steps as cards, for the deployment the switch has chosen. */
export function PlanCards({ plans }: { plans: Record<Deployment, PlanCard[]> }) {
  return (
    <>
      <div className={CLOUD_ONLY}>
        <Cards cards={plans.cloud} />
      </div>
      <div className={SELF_HOSTED_ONLY}>
        <Cards cards={plans.self_hosted} />
      </div>
    </>
  );
}

function Cards({ cards }: { cards: PlanCard[] }) {
  return (
    <div className="grid gap-4 text-left lg:grid-cols-3">
      {cards.map((card) => (
        <article
          key={card.id}
          className="flex flex-col rounded-2xl border border-window-border bg-window p-6 shadow-(--window-shadow) md:p-7"
        >
          <h2 className="font-heading text-2xl text-text-primary leading-tight">{card.name}</h2>
          <p className="mt-2 text-sm text-text-secondary leading-6 lg:min-h-12">{card.line}</p>
          <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-heading text-4xl text-text-primary leading-none tracking-[-0.02em]">
              {card.price}
            </span>
            <span className="text-sm text-text-muted">{card.per}</span>
          </p>
          {/* Everyone starts on Free, so its button is the page's one primary action. */}
          <a href={card.action.href} className={`mt-6 ${card.id === "free" ? PRIMARY : SECONDARY}`}>
            {card.action.label}
          </a>
          {card.lists.map((list) => (
            <List key={list.heading} list={list} />
          ))}
        </article>
      ))}
    </div>
  );
}

function List({ list }: { list: PlanList }) {
  return (
    <div className="mt-7 border-border-primary border-t pt-6">
      <h3 className="font-mono text-text-muted text-xs leading-4">{list.heading}</h3>
      {list.priced ? (
        <ul className="mt-4 flex flex-col gap-2.5 text-sm leading-6">
          {list.items.map((item) => (
            <li key={item.text} className="flex items-baseline justify-between gap-4">
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
            <Feature key={item.text} text={item.text} status={item.status} />
          ))}
        </ul>
      )}
    </div>
  );
}
