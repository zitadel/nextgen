import type { CSSProperties } from "react";
import { HOODS } from "./hoods";
import { FEATURE_GROUPS, FEATURES, type Feature, type FeatureGroup, featurePath } from "./platform";
import { BrowserFrame } from "./showcase/browser-frame";
import { LoginFlow } from "./showcase/login-preview";
import { login } from "./showcase/sessions";
import { SEGMENTS } from "./window";

/**
 * What to see of a feature: the window its page shows under the hood
 * (hoods.tsx); for Sign-in, the login itself, live (login-preview.tsx), the
 * page setup serves in the recorded session (showcase/sessions.ts).
 */
function Shown({ feature }: { feature: Feature }) {
  if (feature.slug === "sign-in") {
    return (
      <BrowserFrame url={login.url} showResult>
        <LoginFlow screens={login.screens} />
      </BrowserFrame>
    );
  }
  return HOODS[feature.slug].artifact;
}

/** A group's name as an id: `features-sign-in`. */
function groupId(group: FeatureGroup): string {
  return `features-${group.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

// What shows a group's features while its tab is chosen, written out whole:
// Tailwind finds a class only as a whole string in the source, and the Record
// makes a new group bring its own.
const SHOWN: Record<FeatureGroup, string> = {
  "Sign-in": "group-has-[#features-sign-in:checked]/caps:contents",
  Customers: "group-has-[#features-customers:checked]/caps:contents",
  Access: "group-has-[#features-access:checked]/caps:contents",
};

/**
 * The features (platform.ts), a tab per group over a list to pick from beside
 * one window: each entry the words people search for it, its title and line,
 * its window and the link to its page. Radio buttons hold both choices, the
 * group and the feature within it, and CSS shows the chosen ones, so it works
 * without script, every window is in the page for crawlers, and the arrow
 * keys move from group to group and from feature to feature. Each group
 * opens on its first feature. From a laptop up the windows stack in one
 * place beside the list and stay in view under the header while it scrolls;
 * below, the chosen feature's window opens under its entry. The entries'
 * highlight reaches into the margin, so their text lines up with the
 * section's heading.
 */
export function Capabilities() {
  const largest = Math.max(
    ...FEATURE_GROUPS.map((group) => FEATURES.filter((feature) => feature.group === group).length),
  );
  return (
    <div
      style={{ "--rows": largest } as CSSProperties}
      className="group/caps -ml-4 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-[auto_repeat(var(--rows),auto)_1fr] lg:gap-x-14"
    >
      <div
        role="radiogroup"
        aria-label="Kinds of feature"
        className={`${SEGMENTS} mb-4 ml-4 w-fit lg:col-span-2`}
      >
        {FEATURE_GROUPS.map((group, index) => (
          <label
            key={group}
            className="cursor-pointer rounded-md px-3 py-1.5 font-semibold text-sm text-text-muted leading-5 transition-colors hover:text-text-primary has-[:checked]:bg-tint/10 has-[:checked]:text-text-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-text-primary"
          >
            <input
              type="radio"
              name="feature-group"
              id={groupId(group)}
              defaultChecked={index === 0}
              className="sr-only"
            />
            {group}
          </label>
        ))}
      </div>
      {FEATURE_GROUPS.map((group) => (
        <div key={group} className={`hidden ${SHOWN[group]}`}>
          {FEATURES.filter((feature) => feature.group === group).map((feature, index) => {
            const id = `feature-${feature.slug}`;
            return (
              <div key={feature.slug} className="contents">
                <input
                  type="radio"
                  name={groupId(group)}
                  id={id}
                  defaultChecked={index === 0}
                  className="peer sr-only"
                />
                <label
                  htmlFor={id}
                  className="flex cursor-pointer flex-col gap-1 rounded-xl px-4 py-3 transition-colors hover:bg-tint/[0.04] peer-checked:bg-tint/[0.07] peer-focus-visible:outline-2 peer-focus-visible:outline-text-primary lg:col-start-1"
                >
                  <span className="block font-mono text-text-muted text-xs leading-4 first-letter:uppercase">
                    {feature.keywords}
                  </span>
                  <span className="text-balance font-heading text-lg text-text-primary leading-6">
                    {feature.title}
                  </span>
                  <span className="text-pretty text-sm text-text-secondary leading-6">
                    {feature.line}
                  </span>
                </label>
                <div className="flex min-w-0 flex-col items-start gap-4 max-lg:hidden max-lg:pt-3 max-lg:pb-6 max-lg:pl-4 max-lg:peer-checked:flex lg:invisible lg:sticky lg:top-24 lg:col-start-2 lg:row-[2/-1] lg:self-start lg:peer-checked:visible">
                  <div className="w-full">
                    <Shown feature={feature} />
                  </div>
                  <a
                    href={featurePath(feature.slug)}
                    className="group inline-flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
                  >
                    Read about {feature.keywords}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      fill="none"
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                    >
                      <path
                        d="M3 8h10M9 4l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
