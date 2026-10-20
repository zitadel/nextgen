import { BrandRow } from "./brand-row";
import { Finish } from "./finish";
import { RecordedRow } from "./recorded-row";
import { brandStep, sessions } from "./sessions";
import { Spine } from "./spine";
import { stepColor, stepId } from "./step";

// The recorded steps, the brand's and the finish: the stepper's colors
// spread over them, the finish's the last, green.
const COUNT = sessions.length + 2;

const LABELS = [...sessions.map(({ label }) => label), brandStep.label];

/**
 * A link to the step labeled `label`: its anchor, its number and its color
 * as --step, for the hero to point into the steps in their own colors.
 */
export function stepLink(label: string) {
  const index = LABELS.indexOf(label);
  return { href: `#${stepId(label)}`, number: index + 1, style: stepColor(index, COUNT) };
}

/**
 * The hero's commands step by step, then what they let you change
 * (zitadel/new-website's TerminalShowcase): start, setup, a field, the flow,
 * the brand, and the way on, where the stepper ends in green. The steps hang
 * off a spine at their left, in a rail from a tablet up and in the gutter on
 * a phone, which fills as the visitor reads down (spine.tsx).
 */
export function Showcase() {
  return (
    <ol className="relative flex w-full flex-col gap-24 md:gap-32">
      <Spine />
      {sessions.map((session, index) => (
        <RecordedRow key={session.label} session={session} index={index} count={COUNT} />
      ))}
      <BrandRow index={sessions.length} count={COUNT} />
      <Finish index={COUNT - 1} count={COUNT} />
    </ol>
  );
}
