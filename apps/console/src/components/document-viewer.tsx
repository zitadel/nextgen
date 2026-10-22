import { Fragment, useEffect, useMemo, useState } from "react";
import { stringify as stringifyYaml } from "yaml";

import { CLI_DEPLOY, CliCommand, CliHint } from "@/components/cli-hint";
import { CopyButton } from "@/components/ui/copy-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CodeLanguage, type CodeLine, highlightCode } from "@/lib/highlight";

/**
 * `lineWidth: 0` disables YAML's line folding. Folding is legal and Shiki reads
 * it correctly, but a wrapped URL is worse to read and worse to paste, and the
 * point of the panel is a document an operator copies into their repo.
 */
const YAML_OPTIONS = { indent: 2, lineWidth: 0 } as const;

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
 */
export function DocumentViewer({ document, noun }: { document: unknown; noun: string }) {
  const [format, setFormat] = useState<CodeLanguage>("json");

  const source = useMemo(
    () =>
      format === "yaml" ? stringifyYaml(document, YAML_OPTIONS) : JSON.stringify(document, null, 2),
    [document, format],
  );
  const lines = useHighlighted(source, format);

  return (
    // `flex-1 min-w-0` so the viewer takes the width the field table leaves and
    // its own long lines scroll inside it — without it the `pre` sizes to its
    // content and pushes the panel out of the card.
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      {/* 4px vertical inset: the header is 48px around a 40px tab strip. */}
      <div className="flex items-center justify-between border-b border-border py-1 pr-2.5 pl-3">
        <Tabs value={format} onValueChange={(next) => setFormat(next as CodeLanguage)}>
          <TabsList>
            <TabsTrigger value="json" variant="muted">
              JSON
            </TabsTrigger>
            <TabsTrigger value="yaml" variant="muted">
              YAML
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <CopyButton
          value={source}
          label={`Copy the ${noun} document as ${format.toUpperCase()}`}
          size="sm"
        />
      </div>

      {/* The design's code block hugs its content, but it is drawn around a
          ten-line sample; a real schema runs to a few hundred lines, which
          would push the CLI hint — the point of the panel — thousands of
          pixels below the fold and leave the field table stranded beside a
          column of JSON. Capping the viewport keeps the hint at the foot and
          the two panels the same order of height the design pairs them at. */}
      <pre className="max-h-[32rem] overflow-auto p-4 font-mono text-xs leading-5 text-(--zl-syntax-punctuation)">
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

      <CliHint>
        Edit the {noun} locally, then deploy your changes with <CliCommand>{CLI_DEPLOY}</CliCommand>
        . Deploying creates a new revision.
      </CliHint>
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
