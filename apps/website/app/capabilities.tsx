import type { CSSProperties } from "react";
import { Capped } from "./brand/capped";
import { type IconName, LottieIcon } from "./brand/lottie-icon";
import { HOODS } from "./hoods";
import { FEATURE_GROUPS, FEATURES, type Feature, type FeatureGroup, featurePath } from "./platform";
import { BrowserFrame } from "./showcase/browser-frame";
import { LoginFlow } from "./showcase/login-preview";
import { login } from "./showcase/sessions";
import { SEGMENTS } from "./window";

/**
 * What to see of a feature: the window its page shows under the hood
 * (hoods.tsx); for Passkeys & passwords, the login itself, live
 * (login-preview.tsx), the page setup serves in the recorded session
 * (showcase/sessions.ts).
 */
function Shown({ feature }: { feature: Feature }) {
  if (feature.slug === "passkeys-and-passwords") {
    return (
      <BrowserFrame url={login.url} showResult>
        <LoginFlow screens={login.screens} />
      </BrowserFrame>
    );
  }
  return HOODS[feature.slug].artifact;
}

/** A group's name as an id: `features-identity`, `features-b2b`. */
function groupId(group: FeatureGroup): string {
  return `features-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// The brand's animated icon on each group's tab: a ring for identity,
// stacked layers for each customer's own team, bars for levels of access.
const ICONS: Record<FeatureGroup, IconName> = {
  Identity: "circle",
  B2B: "triangle",
  Access: "bars",
};

// What shows a group's features while its tab is chosen, written out whole:
// Tailwind finds a class only as a whole string in the source, and the Record
// makes a new group bring its own.
const SHOWN: Record<FeatureGroup, string> = {
  Identity: "group-has-[#features-identity:checked]/caps:contents",
  B2B: "group-has-[#features-b2b:checked]/caps:contents",
  Access: "group-has-[#features-access:checked]/caps:contents",
};

/**
 * The features (platform.ts), a tab per group over a list to pick from beside
 * one window: each entry the words people search for it, its title and line,
 * its window, no taller than the default one's (capped.tsx), and the link to
 * its page. Each group's tab carries the brand's animated icon. Radio
 * buttons hold both choices, the
 * group and the feature within it, and CSS shows the chosen ones, so it works
 * without script, every window is in the page for crawlers, and the arrow
 * keys move from group to group and from feature to feature. Each group
 * opens on its first feature. From a laptop up the chosen window stands
 * beside the list, alone, so the section ends where the taller of the two
 * does, and stays in view under the header while the list scrolls; below,
 * it opens under its entry. The entries'
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
            className="flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-3 pl-1.5 font-semibold text-sm text-text-muted leading-5 transition-colors hover:text-text-primary has-[:checked]:bg-tint/10 has-[:checked]:text-text-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-text-primary"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-icon-chip">
              <LottieIcon name={ICONS[group]} className="size-6" />
            </span>
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
                <div className="hidden min-w-0 flex-col items-start gap-4 peer-checked:flex max-lg:pt-3 max-lg:pb-6 max-lg:pl-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-[2/-1] lg:self-start">
                  <div className="w-full">
                    <Capped href={featurePath(feature.slug)}>
                      <Shown feature={feature} />
                    </Capped>
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
