import type { ReactNode } from "react";
import { links } from "../links";
import {
  type Catalog,
  dollars,
  type Hub,
  hubMeters,
  hubPrice,
  included,
  meterPrice,
  sentence,
} from "./catalog";
import { StatusTag } from "./compare-table";
import { CLOUD_ONLY, Features, H2, LINK, SELF_HOSTED_ONLY } from "./parts";
import { hubStatus, meterStatus, works } from "./status";

const CELLS =
  "grid gap-x-8 gap-y-5 p-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_minmax(0,5fr)] md:p-7";
/** A row under another; the list's first row has the list's own border over it. */
const ROW = `${CELLS} border-border-primary border-t`;
const NAME = "font-heading text-text-primary text-xl leading-tight";

/**
 * Everything that can go on top of Free, as one price list with one row shape:
 * the add-ons that work today, what each of them includes, the capacity and
 * support lines, then what's coming, which shows no price until it is Coming
 * next.
 */
export function AddOns({ catalog }: { catalog: Catalog }) {
  const working = catalog.hubs.filter((hub) => works(hubStatus(hub)));
  const coming = catalog.hubs.filter((hub) => !works(hubStatus(hub)));
  const listed = catalog.licensed.filter(
    (line) => line.plans.includes("pro") && line.amount !== null,
  );
  const { support } = catalog.self_hosted;
  return (
    <section aria-labelledby="add-ons" className="mt-20 scroll-mt-24 md:mt-28">
      <h2 id="add-ons" className={H2}>
        Add-ons
      </h2>
      <div className="mt-8 overflow-hidden rounded-2xl border border-window-border bg-window shadow-(--window-shadow)">
        {working.map((hub, index) => (
          <HubRow key={hub.id} hub={hub} catalog={catalog} first={index === 0} />
        ))}

        <Group>Included with every add-on</Group>
        <div className={ROW}>
          <h3 className={NAME}>Production basics</h3>
          <div className="md:col-span-2">
            <Features labels={catalog.hub_includes} columns />
          </div>
        </div>

        <Group>Scale and support, with any add-on</Group>
        <div className={CLOUD_ONLY}>
          {listed.map((line) => (
            <div key={line.id} className={ROW}>
              <h3 className={NAME}>{line.label}</h3>
              <p className="text-sm text-text-secondary leading-6">
                {line.note ? sentence(line.note) : ""}
              </p>
              <Price
                amount={dollars(line.amount ?? 0)}
                per={`/ ${line.interval}${line.per ? ` per ${line.per}` : ""}`}
              />
            </div>
          ))}
        </div>
        <div className={SELF_HOSTED_ONLY}>
          <div className={ROW}>
            <h3 className={NAME}>{support.label}</h3>
            <p className="text-sm text-text-secondary leading-6">
              {support.note ? sentence(support.note) : ""}
            </p>
            <Price
              amount={dollars(support.amount)}
              per={`/ ${support.interval} per ${support.per}`}
            />
          </div>
        </div>

        {coming.length > 0 && (
          <>
            <Group>What's coming</Group>
            {coming.map((hub) => (
              <ComingRow key={hub.id} hub={hub} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

/** A label over the rows that follow. */
function Group({ children }: { children: ReactNode }) {
  return (
    <p className="border-border-primary border-t bg-window-bar px-6 py-2.5 font-mono text-text-muted text-xs leading-5 md:px-7">
      {children}
    </p>
  );
}

function Price({ amount, per }: { amount: string; per: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      <span className="font-heading text-2xl text-text-primary leading-none tracking-[-0.02em]">
        {amount}
      </span>
      <span className="text-sm text-text-muted">{per}</span>
    </p>
  );
}

/** An add-on that works today: who it is for, what it adds, its base fee and its usage prices. */
function HubRow({ hub, catalog, first }: { hub: Hub; catalog: Catalog; first: boolean }) {
  const meters = hubMeters(catalog, hub.id);
  return (
    <div className={first ? CELLS : ROW}>
      <div>
        <h3 className={NAME}>{hub.label}</h3>
        <p className="mt-2 text-sm text-text-secondary leading-6">{hub.line}</p>
      </div>
      <Features labels={hub.features} />
      <div>
        <Price amount={hubPrice(hub)} per={`/ ${hub.base.interval}`} />
        <p className={`mt-1 text-text-muted text-xs leading-5 ${SELF_HOSTED_ONLY}`}>
          per {catalog.self_hosted.hubs.per}
        </p>
        {meters.length > 0 && (
          <dl className="mt-4 flex flex-col gap-2.5 text-sm leading-5">
            {meters.map((meter) => {
              const [price = ""] = meterPrice(meter);
              const status = meterStatus(meter, catalog);
              return (
                <div key={meter.id}>
                  <dt className="flex flex-wrap items-center gap-x-2 gap-y-1 text-text-primary">
                    <span className={works(status) ? undefined : "opacity-55"}>{meter.label}</span>
                    {status !== "available" && <StatusTag status={status} />}
                  </dt>
                  <dd
                    className={`mt-0.5 text-text-muted text-xs leading-5 ${works(status) ? "" : "opacity-55"}`}
                  >
                    {meter.allowance ? `${included(meter, meter.allowance)} included, then ` : ""}
                    {price}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </div>
  );
}

/** An add-on still to come: what it will do, its status, and who to tell. */
function ComingRow({ hub }: { hub: Hub }) {
  const status = hubStatus(hub);
  return (
    <div className={ROW}>
      <div>
        <h3 className={`${NAME} flex flex-wrap items-center gap-x-3 gap-y-1`}>
          {hub.label}
          <StatusTag status={status} />
        </h3>
        <p className="mt-2 text-sm text-text-secondary leading-6">{hub.line}</p>
      </div>
      <p className="text-sm text-text-muted leading-6">{hub.features.join(" · ")}</p>
      <div className="text-sm leading-6">
        {status === "next" && hub.base.amount !== null && (
          <p className="text-text-muted">
            Planned: {hubPrice(hub)} / {hub.base.interval}
          </p>
        )}
        <a href={links.contact} className={LINK}>
          Get early access
        </a>
      </div>
    </div>
  );
}
