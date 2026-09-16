import { contrastIssues, type ContrastIssue } from "@zitadel/config/branding-contrast";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  type BrandingDensity,
  type BrandingDraft,
  type BrandingRadius,
  DENSITIES,
  PALETTE_KEYS,
  PALETTE_LABELS,
  type PaletteKey,
  RADIUS_PRESETS,
  type ThemeSide,
  withPaletteValue,
  withSideLogo,
} from "@/lib/branding-draft";

const ROW = "flex items-center justify-between gap-3 py-1.5 text-sm";
const ROW_LABEL = "text-muted-foreground";
const SECTION_TITLE = "text-sm font-medium text-foreground";
const VALUE_INPUT =
  "h-7 w-44 border-transparent bg-transparent px-2 text-right text-sm shadow-none hover:border-input focus-visible:border-input";

type Props = {
  draft: BrandingDraft;
  onChange: (next: BrandingDraft) => void;
};

export function SettingsPanel({ draft, onChange }: Props) {
  // Recomputed on every edit: the counts are the panel's live feedback, and
  // the check is a pure function over a dozen colours.
  const issues = useMemo(() => contrastIssues(draft), [draft]);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-5">
      <header>
        <h2 className={SECTION_TITLE}>Branding</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Override the corresponding theme tokens in your project configuration.
        </p>
      </header>

      <Section title="Typography">
        <TextRow
          label="Font family"
          value={draft.typography?.font_family ?? ""}
          placeholder="Arimo"
          onChange={(value) =>
            onChange({ ...draft, typography: { ...draft.typography, font_family: value } })
          }
        />
        <TextRow
          label="Font URL"
          value={draft.typography?.font_url ?? ""}
          placeholder="https://…/font.css"
          onChange={(value) =>
            onChange({ ...draft, typography: { ...draft.typography, font_url: value } })
          }
        />
        <TextRow
          label="Type scale"
          value={draft.typography?.scale?.toString() ?? ""}
          placeholder="1"
          onChange={(value) =>
            onChange({
              ...draft,
              typography: { ...draft.typography, scale: numberOrUndefined(value) },
            })
          }
        />
      </Section>

      <Section title="Shape">
        <TextRow
          label="Corner radius"
          value={draft.shape?.radius?.toString() ?? ""}
          placeholder="md or 8"
          onChange={(value) =>
            onChange({ ...draft, shape: { ...draft.shape, radius: radiusValue(value) } })
          }
        />
        <TextRow
          label="Density"
          value={draft.shape?.density ?? ""}
          placeholder="regular"
          onChange={(value) =>
            onChange({ ...draft, shape: { ...draft.shape, density: densityValue(value) } })
          }
        />
        <TextRow
          label="Logo scale"
          value={draft.shape?.logo_scale?.toString() ?? ""}
          placeholder="1"
          onChange={(value) =>
            onChange({ ...draft, shape: { ...draft.shape, logo_scale: numberOrUndefined(value) } })
          }
        />
      </Section>

      <Section title="Assets">
        <TextRow
          label="Logo light"
          value={draft.theme?.light?.logo_url ?? ""}
          placeholder="https://…/logo-on-light.svg"
          onChange={(value) => onChange(withSideLogo(draft, "light", value))}
        />
        <TextRow
          label="Logo dark"
          value={draft.theme?.dark?.logo_url ?? ""}
          placeholder="https://…/logo-on-dark.svg"
          onChange={(value) => onChange(withSideLogo(draft, "dark", value))}
        />
      </Section>

      <PaletteSection side="dark" draft={draft} issues={issues} onChange={onChange} />
      <PaletteSection side="light" draft={draft} issues={issues} onChange={onChange} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className={`${SECTION_TITLE} mb-1`}>{title}</h3>
      {children}
    </section>
  );
}

function PaletteSection({
  side,
  draft,
  issues,
  onChange,
}: {
  side: ThemeSide;
  draft: BrandingDraft;
  issues: ContrastIssue[];
  onChange: (next: BrandingDraft) => void;
}) {
  const [open, setOpen] = useState(side === "dark");
  const sideIssues = issues.filter((issue) => issue.theme === side);
  const palette = draft.theme?.[side]?.palette ?? {};

  return (
    <section className="border-t border-border pt-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={SECTION_TITLE}>Colors {side} mode</span>
        <span className="flex items-center gap-2">
          {sideIssues.length > 0 && (
            <Badge variant="destructive">
              {sideIssues.length} {sideIssues.length === 1 ? "issue" : "issues"}
            </Badge>
          )}
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </span>
      </button>

      {open && (
        <div className="mt-2">
          {PALETTE_KEYS.map((key) => (
            <PaletteRow
              key={key}
              paletteKey={key}
              side={side}
              value={palette[key] ?? ""}
              issue={sideIssues.find((candidate) => candidate.pair.startsWith(`${key}/`))}
              onChange={(value) => onChange(withPaletteValue(draft, side, key, value))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PaletteRow({
  paletteKey,
  side,
  value,
  issue,
  onChange,
}: {
  paletteKey: PaletteKey;
  side: ThemeSide;
  value: string;
  issue: ContrastIssue | undefined;
  onChange: (value: string) => void;
}) {
  // Both sides carry a row called "Primary". The visible label sits under its
  // section heading, but the accessible name has to stand on its own — a
  // screen reader reaching two fields both called "Primary" cannot tell which
  // surface it is editing.
  const name = `${PALETTE_LABELS[paletteKey]} (${side} mode)`;
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{PALETTE_LABELS[paletteKey]}</span>
      <span className="flex items-center gap-2">
        {issue && (
          <span
            className="text-destructive"
            title={`Contrast ${issue.ratio}:1, needs ${issue.required}:1`}
          >
            <TriangleAlert className="size-3.5" aria-hidden />
            <span className="sr-only">
              Contrast {issue.ratio} to 1, needs {issue.required} to 1
            </span>
          </span>
        )}
        <span
          aria-hidden
          className="size-3.5 rounded-sm border border-border"
          style={{ background: value || "transparent" }}
        />
        <Input
          aria-label={name}
          className={VALUE_INPUT}
          value={value}
          placeholder="default"
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </div>
  );
}

function TextRow({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <Input
        aria-label={label}
        className={VALUE_INPUT}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `md` stays a preset name, `8` becomes pixels, and anything else clears the
 * field — typing a half-finished value should not publish a broken revision.
 */
function radiusValue(value: string): BrandingRadius | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (RADIUS_PRESETS.includes(trimmed as (typeof RADIUS_PRESETS)[number])) {
    return trimmed as BrandingRadius;
  }
  const pixels = Number.parseInt(trimmed, 10);
  return String(pixels) === trimmed ? pixels : undefined;
}

function densityValue(value: string): BrandingDensity | undefined {
  const trimmed = value.trim();
  return DENSITIES.includes(trimmed as BrandingDensity) ? (trimmed as BrandingDensity) : undefined;
}
