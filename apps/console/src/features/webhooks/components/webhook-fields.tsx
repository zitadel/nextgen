import { useId, useState } from "react";

import { SHEET_CHOICE_CARD, SHEET_LABEL_ROW, SHEET_LEGEND } from "@/components/form-sheet";
import { Badge } from "@/components/ui/badge";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxPlaceholder,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { FieldOptionalIndicator } from "@/components/ui/field-optional-indicator";
import { InlineCode } from "@/components/ui/inline-code";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EVENT_TYPE_GROUPS } from "@/features/events/model";

import { describeEventTypes, type WebhookDraft, type WebhookRefusal } from "../model";

/**
 * A webhook's three fields, for the Add drawer and the webhook's own page:
 * where it is sent, a note on what it is for, and which events it gets.
 *
 * **Events are all of them or a selection.** `All events` is the API's `*`:
 * every type the server writes, the ones a later version adds included, but
 * not `request.api`, one event per API call, which a receiver that calls the
 * API would feed itself with. A selection is chosen from the types Logs
 * filters by, under the same captions (`EVENT_TYPE_GROUPS`), and may name
 * `request.api`. A type the webhook holds that this list no longer offers
 * stays chosen: the server keeps it, and it matches nothing.
 *
 * **Each choice names itself.** The card is the radio's `label`, but the
 * browser reads no name for the radio out of it, so the radio points at the
 * card's title and its note.
 *
 * **A refusal lands on its field.** The server names the field it refused
 * (`webhookRefusal`), and its message shows there in its own words (ADR 030).
 * Editing takes the message away, since it described the value before.
 */
export function WebhookFields({
  draft,
  refusal,
  onChange,
}: {
  draft: WebhookDraft;
  /** The last save's refusal, shown on the field it names. */
  refusal?: WebhookRefusal;
  onChange: (draft: WebhookDraft) => void;
}) {
  const id = useId();
  const urlId = `${id}-url`;
  const descriptionId = `${id}-description`;
  const urlError = refusal?.field === "url" ? refusal.message : undefined;
  const descriptionError = refusal?.field === "description" ? refusal.message : undefined;
  const eventsError = refusal?.field === "event_types" ? refusal.message : undefined;

  return (
    <>
      {/* `aria-describedby` carries the reason: `Field` wires up no
          description of its own. */}
      <Field data-invalid={urlError ? true : undefined}>
        <FieldLabel htmlFor={urlId}>Endpoint URL</FieldLabel>
        <Input
          id={urlId}
          name="url"
          type="url"
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={2048}
          placeholder="https://api.example.com/hooks/zitadel"
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? `${urlId}-error ${urlId}-hint` : `${urlId}-hint`}
          value={draft.url}
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
        />
        <FieldError id={`${urlId}-error`}>{urlError}</FieldError>
        {/* Stays under a refusal: a URL the contract's pattern refuses comes
            back with the server's general message, and this says the rule. */}
        <FieldDescription id={`${urlId}-hint`}>
          An <InlineCode>https</InlineCode> URL with no user name or password in it. Each event is
          sent to it as one POST request.
        </FieldDescription>
      </Field>

      <Field data-invalid={descriptionError ? true : undefined}>
        <div className={SHEET_LABEL_ROW}>
          <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
          <FieldOptionalIndicator />
        </div>
        <Input
          id={descriptionId}
          name="description"
          autoComplete="off"
          placeholder="What this webhook is for"
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={descriptionError ? `${descriptionId}-error` : undefined}
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
        <FieldError id={`${descriptionId}-error`}>{descriptionError}</FieldError>
      </Field>

      <FieldSet className="gap-3">
        <FieldLegend variant="label" className={`${SHEET_LEGEND} mb-0`}>
          Events
        </FieldLegend>
        <RadioGroup
          aria-label="Events"
          className="gap-2"
          value={draft.all ? "all" : "selected"}
          onValueChange={(value) => onChange({ ...draft, all: value === "all" })}
        >
          <FieldLabel htmlFor={`${id}-all`} className={SHEET_CHOICE_CARD}>
            <Field orientation="horizontal" className="items-start">
              <RadioGroupItem
                value="all"
                id={`${id}-all`}
                aria-labelledby={`${id}-all-title`}
                aria-describedby={`${id}-all-note`}
              />
              <FieldContent className="gap-1">
                <FieldTitle id={`${id}-all-title`} className="leading-none font-medium">
                  All events
                </FieldTitle>
                <FieldDescription id={`${id}-all-note`} className="leading-5">
                  Every event type, including types added later. API requests,{" "}
                  <InlineCode>request.api</InlineCode>, are left out.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
          <FieldLabel htmlFor={`${id}-selected`} className={SHEET_CHOICE_CARD}>
            <Field orientation="horizontal" className="items-start">
              <RadioGroupItem
                value="selected"
                id={`${id}-selected`}
                aria-labelledby={`${id}-selected-title`}
                aria-describedby={`${id}-selected-note`}
              />
              <FieldContent className="gap-1">
                <FieldTitle id={`${id}-selected-title`} className="leading-none font-medium">
                  Selected events
                </FieldTitle>
                <FieldDescription id={`${id}-selected-note`} className="leading-5">
                  Only the event types you choose.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        </RadioGroup>
        {!draft.all && (
          <EventTypesField
            chosen={draft.types}
            invalid={eventsError !== undefined}
            errorId={`${id}-events-error`}
            onChange={(types) => onChange({ ...draft, types })}
          />
        )}
        <FieldError id={`${id}-events-error`}>{eventsError}</FieldError>
      </FieldSet>
    </>
  );
}

/**
 * The selection: Logs' type list, several at once. The trigger says how many
 * are chosen, as Logs' filter does, and the list ticks them. Several are
 * named under it too, so what a webhook gets is read without opening the
 * list, a type the list no longer offers included.
 */
function EventTypesField({
  chosen,
  invalid,
  errorId,
  onChange,
}: {
  chosen: string[];
  invalid: boolean;
  errorId: string;
  onChange: (types: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (type: string) =>
    onChange(chosen.includes(type) ? chosen.filter((known) => known !== type) : [...chosen, type]);

  return (
    <>
      <Combobox open={open} onOpenChange={setOpen}>
        <ComboboxAnchor asChild>
          <ComboboxTrigger
            label="Event types"
            open={open}
            invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            onOpen={() => setOpen(true)}
          >
            {chosen.length === 0 ? (
              <ComboboxPlaceholder>Choose event types</ComboboxPlaceholder>
            ) : (
              <ComboboxValue>{describeEventTypes(chosen)}</ComboboxValue>
            )}
          </ComboboxTrigger>
        </ComboboxAnchor>
        <ComboboxContent
          groups={EVENT_TYPE_GROUPS}
          selected={chosen}
          searchPlaceholder="Find a type"
          emptyLabel="No type matches."
          label="Event types"
          closeOnSelect={false}
          onSelect={toggle}
          onClose={() => setOpen(false)}
        />
      </Combobox>
      {chosen.length > 1 && (
        <ul aria-label="Chosen event types" className="flex flex-wrap gap-1.5">
          {chosen.map((type) => (
            <li key={type} className="flex">
              <Badge variant="secondary">{type}</Badge>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
