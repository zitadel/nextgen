import { BrandRow } from "./brand-row";
import { Finish } from "./finish";
import { RecordedRow } from "./recorded-row";
import { sessions } from "./sessions";
import { Spine } from "./spine";

// The recorded steps, the brand's and the finish: the stepper's colors
// spread over them, the finish's the last, green.
const COUNT = sessions.length + 2;

/**
 * The quickstart's commands step by step (/get-started), then what they let
 * you change (zitadel/new-website's TerminalShowcase): start, setup, a field,
 * the flow, the brand, and the way on, where the stepper ends in green. The
 * steps hang off a spine at their left, in a rail from a tablet up and in the
 * gutter on a phone, which fills as the visitor reads down (spine.tsx).
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
