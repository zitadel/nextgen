"use client";

import type { ZlAlert, ZlButton, ZlCheckbox, ZlField, ZlPill } from "@zitadel/components/atoms";

import { ExampleStatus, loadAtoms, useLoaded } from "./shared";

// The atoms sdks/components.mdx shows, each with the attributes a template
// sets most. The props are the atoms' own properties, so a property the
// package renames fails the typecheck here (elements.d.ts).

export type ButtonExampleProps = Partial<
  Pick<ZlButton, "hierarchy" | "size" | "label" | "loading" | "disabled" | "block">
>;

export function ButtonExample(props: ButtonExampleProps) {
  const state = useLoaded(loadAtoms);
  if (state !== "ready") return <ExampleStatus failed={state === "failed"} />;
  return <zl-button {...props} />;
}

export type FieldExampleProps = Partial<
  Pick<ZlField, "label" | "type" | "placeholder" | "error" | "success" | "required" | "disabled">
>;

export function FieldExample(props: FieldExampleProps) {
  const state = useLoaded(loadAtoms);
  if (state !== "ready") return <ExampleStatus failed={state === "failed"} />;
  return <zl-field {...props} />;
}

export type AlertExampleProps = Partial<Pick<ZlAlert, "severity" | "heading" | "dismissible">> & {
  /** The message, the alert's content. */
  message?: string;
};

export function AlertExample({ message, ...props }: AlertExampleProps) {
  const state = useLoaded(loadAtoms);
  if (state !== "ready") return <ExampleStatus failed={state === "failed"} />;
  return <zl-alert {...props}>{message}</zl-alert>;
}

export type CheckboxExampleProps = Partial<
  Pick<ZlCheckbox, "label" | "checked" | "required" | "error" | "disabled">
>;

export function CheckboxExample(props: CheckboxExampleProps) {
  const state = useLoaded(loadAtoms);
  if (state !== "ready") return <ExampleStatus failed={state === "failed"} />;
  return <zl-checkbox {...props} />;
}

export type PillExampleProps = Partial<Pick<ZlPill, "tone">> & {
  /** The pill's text, its content. */
  text?: string;
};

export function PillExample({ text, ...props }: PillExampleProps) {
  const state = useLoaded(loadAtoms);
  if (state !== "ready") return <ExampleStatus failed={state === "failed"} />;
  return <zl-pill {...props}>{text}</zl-pill>;
}
