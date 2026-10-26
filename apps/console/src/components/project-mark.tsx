import { avatarVars } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

/**
 * A project's mark: the gradient a person's avatar is generated from
 * (`@zitadel/components/avatar`), seeded by the project's id, so a project
 * keeps its colours on every screen. It is still and square-cornered, since a
 * project is not a person. It tells projects apart at a glance, where one
 * glyph for every project could not, until a project carries a logo of its
 * own.
 *
 * Decorative: the name always sits beside it, so it is hidden from assistive
 * technology.
 */
export function ProjectMark({ projectId, className }: { projectId: string; className?: string }) {
  return (
    <span
      aria-hidden
      // `!`: the shared `.zl-avatar` rules are unlayered, so they outrank a plain
      // utility, and would keep the mark round and moving.
      className={cn("zl-avatar size-5 shrink-0 animate-none! rounded-sm!", className)}
      style={avatarVars(projectId)}
    />
  );
}
