import { links } from "./links";
import { ArrowLink, SectionHeading } from "./section";

// The ways in after the showcase, as zitadel/new-website's narrative has them
// (its doorsSection): the preview to build with, Zitadel v4 to ship on today,
// and an engineer to talk to.
const doors = [
  {
    title: "Build with the preview",
    description:
      "The commands at the top give you a local Zitadel and a login you control from files in your repo. The docs cover the schemas, the flows, the branding and every SDK.",
    link: { href: links.docs, text: "Read the docs" },
  },
  {
    title: "Ship on Zitadel today",
    description:
      "Zitadel v4 runs in production now, on Zitadel Cloud or self-hosted. This preview is the foundation of its next major version.",
    link: { href: links.zitadel, text: "Go to zitadel.com" },
  },
  {
    title: "Talk to an engineer",
    description:
      "SSO, compliance, migrating from v4 or self-hosting: talk it through with the people who build Zitadel.",
    link: { href: links.contact, text: "Contact us" },
  },
];

export function Doors() {
  return (
    <section aria-labelledby="doors-title" className="px-6 py-16 md:py-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <SectionHeading id="doors-title" label="Next steps" title="Three ways in">
          The preview to build with, Zitadel v4 to ship on today, and an engineer to talk to.
        </SectionHeading>
        <ul className="grid gap-4 md:grid-cols-3">
          {doors.map((door) => (
            <li
              key={door.title}
              className="flex flex-col gap-4 rounded-2xl border border-border-primary bg-linear-to-b from-surface-black-secondary/40 to-background p-6"
            >
              <h3 className="font-heading text-xl leading-7 tracking-[-0.01em]">{door.title}</h3>
              <p className="text-text-secondary leading-6">{door.description}</p>
              <p className="mt-auto text-sm">
                <ArrowLink href={door.link.href}>{door.link.text}</ArrowLink>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
