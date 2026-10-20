import { BrandRow } from "./brand-row";
import { RecordedRow } from "./recorded-row";
import { sessions } from "./sessions";

/**
 * The hero's commands step by step, then what they let you change, as
 * alternating rows along a spine (zitadel/new-website's TerminalShowcase):
 * start, setup, a field, the flow, the brand. From laptop width a line runs
 * down the middle and the step numbers sit on it; it comes in from the hero,
 * where it begins under the buttons (page.tsx), so it starts at full strength
 * and fades out only after the last step.
 */
export function Showcase() {
  return (
    <ol className="relative flex w-full flex-col gap-20 md:gap-28 lg:gap-32">
      <li
        aria-hidden="true"
        className="absolute top-0 bottom-5 left-1/2 hidden w-px -translate-x-1/2 bg-[linear-gradient(to_bottom,#484a57,#484a57_94%,transparent)] lg:block"
      />
      {sessions.map((session, index) => (
        <RecordedRow key={session.label} session={session} index={index} />
      ))}
      <BrandRow index={sessions.length} />
    </ol>
  );
}
