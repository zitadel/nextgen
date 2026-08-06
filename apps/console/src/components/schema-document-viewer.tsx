import { Fragment, useEffect, useMemo, useState } from "react";
import { stringify as stringifyYaml } from "yaml";

import { CopyButton } from "@/components/ui/copy-button";
import { InlineCode } from "@/components/ui/inline-code";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CodeLanguage, type CodeLine, highlightCode } from "@/lib/highlight";
import type { UserSchema } from "@/lib/schema";

/**
 * The command the footer tells an operator to run (decisions log D0b).
 *
 * The published CLI, invoked without installing it — the repo is in changesets
 * prerelease mode on the `alpha` dist-tag, which is the tag the design names.
 */
const CLI_COMMAND = "npx @zitadel/cli@alpha apply";

/**
 * `lineWidth: 0` disables YAML's line folding. Folding is legal and Shiki reads
 * it correctly, but a wrapped URL is worse to read and worse to paste, and the
 * point of the panel is a document an operator copies into their repo.
 */
const YAML_OPTIONS = { indent: 2, lineWidth: 0 } as const;

/**
 * The schema document, rendered read-only in JSON or YAML with a copy button
 * and the CLI hint beneath it.
 *
 * Read-only is the whole point of the panel rather than a limitation of it:
 * schemas are configuration edited through the CLI, never in the portal
 * (decisions log D0b), so the screen's job is to show the document an operator
 * would edit and name the command that applies it.
 */
export function SchemaDocumentViewer({ schema }: { schema: UserSchema }) {
  const [format, setFormat] = useState<CodeLanguage>("json");

  const source = useMemo(
    () =>
      format === "yaml"
        ? stringifyYaml(schema, YAML_OPTIONS)
        : JSON.stringify(schema, null, 2),
    [schema, format],
  );
  const lines = useHighlighted(source, format);

  return (
    // `flex-1 min-w-0` so the viewer takes the width the field table leaves and
    // its own long lines scroll inside it — without it the `pre` sizes to its
    // content and pushes the panel out of the card.
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
      {/* 4px vertical inset, not the 10px the Figma code export emits: the
          header frame is 48px tall around a 40px tab strip. */}
      <div className="flex items-center justify-between border-b border-border py-1 pr-2.5 pl-3">
        <Tabs value={format} onValueChange={(next) => setFormat(next as CodeLanguage)}>
          <TabsList className={TABS_LIST}>
            <TabsTrigger value="json" className={TABS_TRIGGER}>
              JSON
            </TabsTrigger>
            <TabsTrigger value="yaml" className={TABS_TRIGGER}>
              YAML
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <CopyButton
          value={source}
          label={`Copy the schema document as ${format.toUpperCase()}`}
          size="sm"
        />
      </div>

      {/* The design's code block hugs its content, but it is drawn around a
          ten-line sample; a real schema runs to a few hundred lines, which
          would push the CLI hint — the point of the panel — thousands of
          pixels below the fold and leave the field table stranded beside a
          column of JSON. Capping the viewport keeps the hint at the foot and
          the two panels the same order of height the design pairs them at. */}
      <pre className="max-h-[32rem] overflow-auto p-4 font-mono text-xs leading-5 text-[var(--zl-syntax-punctuation)]">
        {/* Plain until the grammars compile — same face, size and leading, so
            the block does not reflow when the colour arrives. */}
        <code>
          {lines
            ? lines.map((line, index) => (
                <Fragment key={index}>
                  {index > 0 && "\n"}
                  {line.map((token, position) => (
                    <span key={position} style={{ color: token.color }}>
                      {token.content}
                    </span>
                  ))}
                </Fragment>
              ))
            : source}
        </code>
      </pre>

      {/* Inline flow, not a flex row: the design's `CLI Instructions` frame is
          three auto-layout children with a 4px gap, which puts a space in front
          of the full stop. Normal inline text wraps the same way and lets the
          punctuation hug the command. */}
      <p className="border-t border-border py-3 pr-3 pl-4 text-xs leading-4 text-muted-foreground">
        Edit the schema locally, then apply your changes with{" "}
        <InlineCode className="text-[10px]">{CLI_COMMAND}</InlineCode>. Applying creates a new
        revision.
      </p>
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

// The design's tab strip is filled on the active trigger (`base/muted`), where
// the installed shadcn default paints `background` in light and `input/30` in
// dark. Named constants so Tailwind's scanner sees the full literals.
const TABS_LIST = "h-10 p-[3px]";
const TABS_TRIGGER =
  "flex-none data-[state=active]:bg-muted dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-muted";
