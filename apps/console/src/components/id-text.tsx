import { cn } from "@/lib/utils";

/**
 * An id split where it is cut in the middle: its head, and the tail that
 * tells it from its neighbours. A URI keeps its last two path segments,
 * `/v2/profile.schema.json`; one with fewer splits at its last `/` or `:`; any
 * other id keeps its last six characters, where two minted ids differ. A
 * short id keeps no tail.
 */
export function splitId(id: string): [head: string, tail: string] {
  const path = id.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  const slashes = [...path.matchAll(/\//g)].map((match) => match.index);
  let at = slashes.length >= 2 ? slashes[slashes.length - 2] : slashes[slashes.length - 1];
  if (at !== undefined) {
    at += id.length - path.length;
    return [id.slice(0, at), id.slice(at)];
  }
  if (path !== id) return [id, ""];
  const colon = id.lastIndexOf(":");
  if (colon > 0) return [id.slice(0, colon), id.slice(colon)];
  return id.length > 12 ? [id.slice(0, -6), id.slice(-6)] : [id, ""];
}

/**
 * An id on one line, cut in the middle when it does not fit: the head gives
 * way from its end, so its prefix stays as long as there is room, and the
 * tail stays whole, so ids that share a prefix still read apart. Only a tail
 * wider than the box less the head's minimum is cut too, from its start: a
 * right-to-left box puts that ellipsis first, and the text inside it stays
 * left to right. A screen reader gets the whole id, or `label`.
 */
export function IdText({
  id,
  label = id,
  title,
  className,
}: {
  /** What is drawn: the id, or a short form of it. */
  id: string;
  /** What a screen reader gets, when it is not `id`: the whole id behind a short form. */
  label?: string;
  title?: string;
  className?: string;
}) {
  const [head, tail] = splitId(id);
  if (!tail && label === id) {
    return (
      <span className={cn("min-w-0 truncate", className)} title={title}>
        {id}
      </span>
    );
  }
  if (!tail) {
    return (
      <span className={cn("flex min-w-0", className)} title={title}>
        <span className="sr-only">{label}</span>
        <span aria-hidden className="min-w-0 truncate">
          {id}
        </span>
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0", className)} title={title}>
      {/* The parts are boxes of their own, which an accessible name joins
          with a space; the whole id is read once instead. */}
      <span className="sr-only">{label}</span>
      <span aria-hidden className="flex min-w-0">
        {/* Room for one character and the ellipsis, which Chrome keeps
            together: cut to nothing, the id would read as a shorter one. */}
        <span className="min-w-6 truncate">{head}</span>
        <span className="max-w-[calc(100%-(--spacing(6)))] shrink-0 truncate text-left [direction:rtl]">
          <bdi dir="ltr">{tail}</bdi>
        </span>
      </span>
    </span>
  );
}
