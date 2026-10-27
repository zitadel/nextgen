import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { stringify as stringifyYaml } from "yaml";

import { CLI_DEPLOY, CliCommand, CliHint } from "@/components/cli-hint";
import { CopyButton } from "@/components/ui/copy-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CodeLanguage, type CodeLine, highlightCode } from "@/lib/highlight";
import { cn } from "@/lib/utils";

/**
 * `lineWidth: 0` disables YAML's line folding. Folding is legal and Shiki reads
 * it correctly, but a wrapped URL is worse to read and worse to paste, and the
 * point of the panel is a document an operator copies into their repo.
 */
const YAML_OPTIONS = { indent: 2, lineWidth: 0 } as const;

/** What the viewer shows: the document as fields, or its source. */
type View = "fields" | CodeLanguage;

/** The compact viewer's active tab: `accent` reads on `popover` in both themes. */
const ACCENT_TAB = "data-[state=active]:bg-accent";

/**
 * A configuration document, rendered read-only in JSON or YAML with a copy
 * button and the CLI hint beneath it.
 *
 * Read-only is the whole point of the panel rather than a limitation of it:
 * schemas and flow definitions are configuration edited through the CLI, never
 * in the portal (decisions log D0b), so the screen's job is to show the
 * document an operator would edit and name the command that applies it.
 *
 * `noun` is what the footer calls the document ("schema", "definition") and
 * what the copy button announces. The two screens draw the same panel around
 * different documents, so the noun is the only thing that varies.
 *
 * `compact` is the viewer inside a popover (a user's attributes on the Users
 * list). Those are data rather than configuration, so it drops the CLI hint;
 * it runs edge to edge under the popover's header instead of in a bordered
 * box of its own, starts the tab labels on the Fields list's 16px inset, and
 * frames the source in a bordered code block capped at a popover's height. The active tab takes `accent`: on `popover` a
 * `muted` fill is the surface's own colour in dark mode and would not show.
 *
 * `fields` adds a Fields tab before JSON and YAML, open first: the same
 * document as a list a reader reads rather than copies, so it has no copy
 * button of its own.
 */
export function DocumentViewer({
  document,
  noun,
  compact = false,
  fields,
}: {
  document: unknown;
  noun: string;
  compact?: boolean;
  fields?: ReactNode;
}) {
  const [view, setView] = useState<View>(fields ? "fields" : "json");
  const format: CodeLanguage = view === "yaml" ? "yaml" : "json";

  const source = useMemo(
    () =>
      format === "yaml" ? stringifyYaml(document, YAML_OPTIONS) : JSON.stringify(document, null, 2),
    [document, format],
  );
  const lines = useHighlighted(source, format);
  const tab = cn(compact && ACCENT_TAB);

  return (
    // `flex-1 min-w-0` so the viewer takes the width the field table leaves and
    // its own long lines scroll inside it — without it the `pre` sizes to its
    // content and pushes the panel out of the card.
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col overflow-hidden border-border",
        compact ? "border-t" : "rounded-md border",
      )}
    >
      {/* 4px vertical inset: the header is 48px around a 40px tab strip.
          Compact, the 5px start inset plus the strip's 3px and the trigger's
          8px put the first label on the Fields list's 16px. */}
      <div
        className={cn(
          "flex items-center justify-between border-b border-border py-1",
          compact ? "pr-2 pl-[5px]" : "pr-2.5 pl-3",
        )}
      >
        <Tabs value={view} onValueChange={(next) => setView(next as View)}>
          <TabsList>
            {fields && (
              <TabsTrigger value="fields" variant="muted" className={tab}>
                Fields
              </TabsTrigger>
            )}
            <TabsTrigger value="json" variant="muted" className={tab}>
              JSON
            </TabsTrigger>
            <TabsTrigger value="yaml" variant="muted" className={tab}>
              YAML
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {view !== "fields" && (
          <CopyButton
            value={source}
            label={`Copy the ${noun} document as ${format.toUpperCase()}`}
            size="sm"
          />
        )}
      </div>

      {view === "fields" && (
        <div className={cn("overflow-auto", compact ? "max-h-80" : "max-h-[32rem]")}>{fields}</div>
      )}

      {/* The design's code block hugs its content, but it is drawn around a
          ten-line sample; a real schema runs to a few hundred lines, which
          would push the CLI hint — the point of the panel — thousands of
          pixels below the fold and leave the field table stranded beside a
          column of JSON. Capping the viewport keeps the hint at the foot and
          the two panels the same order of height the design pairs them at. */}
      <pre
        hidden={view === "fields"}
        className={cn(
          "overflow-auto p-4 font-mono text-xs leading-5 text-(--zl-syntax-punctuation)",
          // Compact, the source sits in a bordered code block of its own, a
          // shade below the popover, as the schema screen frames it: it reads
          // as text to copy, apart from the Fields list on the popover's
          // surface. Dark, the full canvas is too deep against `popover`.
          compact
            ? "m-3 max-h-72 rounded-md border border-border bg-background dark:bg-background/40"
            : "max-h-[32rem]",
        )}
      >
        {/* Plain until the grammars compile — same face, size and leading, so
            the block does not reflow when the colour arrives. */}
        <code>
          {lines
            ? lines.map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static syntax-highlighted lines, never reordered
                <Fragment key={index}>
                  {index > 0 && "\n"}
                  {line.map((token, position) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static highlight tokens within a line, never reordered
                    <span key={position} style={{ color: token.color }}>
                      {token.content}
                    </span>
                  ))}
                </Fragment>
              ))
            : source}
        </code>
      </pre>

      {!compact && (
        <CliHint>
          Edit the {noun} locally, then deploy your changes with{" "}
          <CliCommand>{CLI_DEPLOY}</CliCommand>. Deploying creates a new revision.
        </CliHint>
      )}
    </div>
  );
}

/**
 * Highlighted lines, or `undefined` until the grammars have compiled.
 *
 * Shiki loads and compiles its grammars asynchronously. The document renders
 * unhighlighted in the meantime rather than blocking the tab behind a spinner —
 * it is the same text either way, so the only thing that changes is colour.
 */
function useHighlighted(source: string, lang: CodeLanguage): CodeLine[] | undefined {
  const [lines, setLines] = useState<CodeLine[]>();

  useEffect(() => {
    let current = true;
    setLines(undefined);
    void highlightCode(source, lang).then(
      (next) => current && setLines(next),
      // Highlighting is decoration. If a grammar fails to load, the plain
      // document is still the thing the operator came for.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [source, lang]);

  return lines;
}
