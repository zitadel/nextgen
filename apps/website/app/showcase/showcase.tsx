import { BrandRow } from "./brand-row";
import { RecordedRow } from "./recorded-row";
import { sessions } from "./sessions";

/**
 * The hero's commands step by step, then what they let you change, as
 * alternating rows along a spine (zitadel/new-website's TerminalShowcase):
 * start, setup, a field, the flow, the brand. On wide screens a line runs
 * down the middle and the step numbers sit on it.
 */
export function Showcase() {
  return (
    <ol className="relative flex w-full flex-col gap-20 md:gap-28 xl:gap-32">
      <li
        aria-hidden="true"
        className="absolute top-5 bottom-5 left-1/2 hidden w-px -translate-x-1/2 bg-[linear-gradient(to_bottom,transparent,#484a57_6%,#484a57_94%,transparent)] xl:block"
      />
      {sessions.map((session, index) => (
        <RecordedRow key={session.label} session={session} index={index} />
      ))}
      <BrandRow index={sessions.length} />
    </ol>
  );
}
