import { Check, ChevronRight, X } from "lucide-react";
import { Fragment, useState } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type SchemaProperty,
  type UserSchema,
  resolveSchemaPath,
  schemaProperties,
} from "@/lib/schema";

/** Breadcrumb label for the document root. */
const ROOT_LABEL = "Schema";

/**
 * The schema's properties as a `FIELD | TYPE | REQ.` table, with drill-in for
 * nested objects.
 *
 * The list is flat rather than an accordion or a left-hand tree (decisions log
 * D14): schema setup is expected to get complex, so the panel stays roomy and
 * depth is expressed by replacing the table rather than nesting inside it. A
 * row whose type is `Object` opens that object's own properties and pushes a
 * breadcrumb segment; the breadcrumb walks back up.
 *
 * D14 also calls for a search field once an attribute list gets long. Nothing
 * here is long yet — the shipped presets define one to four properties — so the
 * control is left out rather than shipped empty; add it with the schema that
 * needs it.
 *
 * The panel carries no timestamp: the design's `Last changed` line was removed
 * from both this component (`1389:8803`) and the drill-in frame, and the date a
 * schema was created now lives on the list row instead.
 */
export function SchemaFieldsPanel({ schema }: { schema: UserSchema }) {
  const [path, setPath] = useState<string[]>([]);

  // A path can only go stale by drilling in, so this cannot happen today — but
  // it is one prop change (a bookmarked depth, a reloaded schema) away, and
  // falling back to the root beats rendering a table with no rows.
  const node = resolveSchemaPath(schema, path) ?? schema;
  const properties = schemaProperties(node);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Breadcrumb path={path} onNavigate={setPath} />

      {/* `table-fixed` so the declared column widths are exact rather than a
          hint the auto layout can widen. The design pads the row by 8px and
          leaves the cells flush, which a table expresses as padding on the
          outer two cells — so `Req.` is 70px of content inside a 78px column. */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`${HEAD_CELL} pl-2`}>Field</TableHead>
            <TableHead className={`${HEAD_CELL} w-[110px]`}>Type</TableHead>
            <TableHead className={`${HEAD_CELL} w-[78px] pr-2`}>Req.</TableHead>
          </TableRow>
        </TableHeader>
        {/* The design keeps the rule under the last row — it is the card's
            bottom edge, and the panel has no border of its own. */}
        <TableBody className="[&_tr:last-child]:border-b">
          {properties.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="h-16 px-2 text-center text-muted-foreground">
                This {path.length === 0 ? "schema" : "object"} defines no properties.
              </TableCell>
            </TableRow>
          ) : (
            properties.map((property) => (
              <PropertyRow
                key={property.key}
                property={property}
                onDrillIn={() => setPath([...path, property.key])}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// Figma's column labels use the display face, uppercase 12px with 0.72px
// tracking — the same treatment the users table gives its headers.
const HEAD_CELL =
  "h-auto px-0 py-3 font-serif text-xs font-normal tracking-[0.72px] text-muted-foreground uppercase";
const BODY_CELL = "truncate px-0 py-3 text-sm";

function PropertyRow({
  property,
  onDrillIn,
}: {
  property: SchemaProperty;
  onDrillIn: () => void;
}) {
  return (
    <TableRow className={property.isObject ? "relative hover:bg-accent" : "hover:bg-transparent"}>
      <TableCell className={`${BODY_CELL} pl-2 text-foreground`}>
        {property.isObject ? (
          // A stretched hit area: one focusable control, but a click anywhere on
          // the row activates it — so the row-wide hover the design shows is not
          // promising an affordance the row does not have.
          <button
            type="button"
            onClick={onDrillIn}
            className="flex items-center gap-1.5 text-left after:absolute after:inset-0 after:content-['']"
          >
            {property.key}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </button>
        ) : (
          property.key
        )}
      </TableCell>
      <TableCell className={`${BODY_CELL} text-muted-foreground`}>{property.type}</TableCell>
      <TableCell className={`${BODY_CELL} pr-2`}>
        {property.required ? (
          <>
            <Check className="size-4 text-foreground" aria-hidden />
            <span className="sr-only">Required</span>
          </>
        ) : (
          <>
            <X className="size-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">Optional</span>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * The drill-in path.
 *
 * Not page navigation, so it is not the breadcrumb the console rules out
 * (decisions log D13) — it addresses a position inside one document, the way a
 * file path does, and there is no route behind any segment.
 *
 * Deep paths elide the middle (`Schema › … › datum › reference`) so the trail
 * stays on one line; the ellipsis is inert because it stands for more than one
 * level and picking which to jump to would be a guess.
 */
function Breadcrumb({ path, onNavigate }: { path: string[]; onNavigate: (next: string[]) => void }) {
  const segments = [ROOT_LABEL, ...path];
  const last = segments.length - 1;
  const at = (depth: number) => ({ label: segments[depth] ?? "", depth });
  const visible =
    segments.length > 3
      ? [at(0), { label: "…", depth: -1 }, at(last - 1), at(last)]
      : segments.map((label, depth) => ({ label, depth }));

  return (
    <nav aria-label="Schema path" className="flex flex-wrap items-center gap-1.5">
      {visible.map((segment, index) => {
        const current = segment.depth === last;
        return (
          <Fragment key={`${segment.label}-${index}`}>
            {index > 0 && (
              <span aria-hidden className="text-[13px] text-muted-foreground">
                ›
              </span>
            )}
            {current || segment.depth < 0 ? (
              <span
                aria-current={current ? "true" : undefined}
                className={`${SEGMENT} ${current ? "text-foreground" : "text-muted-foreground"}`}
              >
                {segment.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(path.slice(0, segment.depth))}
                className={`${SEGMENT} text-muted-foreground hover:text-foreground`}
              >
                {segment.label}
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

const SEGMENT = "font-serif text-xs leading-4 tracking-[0.72px] uppercase";
