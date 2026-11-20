import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { api } from "@/api/zitadel";
import {
  CARD_ACTION_BUTTON,
  DetailSection,
  FIELD_GROUP_LABEL_RAIL,
} from "@/components/detail-page";
import { FormError } from "@/components/form-error";
import { SchemaFields, type SchemaFieldsLayout } from "@/features/schemas/components/schema-fields";
import { FIELD_LABEL_TYPOGRAPHY } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { useSchemaForm } from "@/features/schemas/use-schema-form";
import { useSubmit } from "@/hooks/use-submit";
import { RevisionLink } from "@/features/schemas/components/revision-link";
import { RevisionBadges } from "@/features/schemas/components/revision-select";
import {
  type SchemaRevision,
  type UserSchema,
  schemaDisplayName,
  schemaFields,
} from "@/features/schemas/model";
import { UserRevisionSheet } from "@/features/users/components/user-revision-sheet";
import {
  attributesPatch,
  draftFromAttributes,
  formRoot,
  unwritableMessage,
  unwritableRequired,
} from "@/features/schemas/schema-form";

// Long utility strings live as named constants so Tailwind's scanner sees the
// full literal (it never sees a concatenated fragment).
// The design's inputs are 360px wide rather than stretched across the row.
const INPUT_WIDTH = "max-w-90";
// The design's field label is the body face at 14/21, regular weight, where
// `FieldLabel` defaults to the display face.
const FIELD_LABEL = "text-foreground font-sans leading-normal";

// The profile's fields sit on the detail cards' label rail on a wide row, so
// the inputs start where the schema name above them does.
const PROFILE_LAYOUT: SchemaFieldsLayout = {
  orientation: "responsive",
  // On a wide row the column is the control's 36px, so a one-line label centres
  // on it while an error under the control leaves it in place.
  labelRow: `flex flex-wrap items-center gap-2 @md/field-group:min-h-9 ${FIELD_GROUP_LABEL_RAIL}`,
  label: FIELD_LABEL,
  control: INPUT_WIDTH,
};

/**
 * The profile: the user's attributes as its schema labels them, saved with
 * `PATCH /users/{user_id}`. The drafts follow the loaded user: a save re-runs
 * the loader, and they reset to what was stored.
 */
export function UserProfileCard({
  userId,
  schema,
  schemaId,
  ownRevisionId,
  latestSchemaId,
  revisions,
  attributes,
  onSaved,
}: {
  userId: string;
  schema: UserSchema | undefined;
  schemaId: string | undefined;
  /** The newest revision of the user's schema, which its name opens; absent when unknown. */
  latestSchemaId?: string;
  /** The revision the user is on, by the id the schema's history lists it under. */
  ownRevisionId: string | undefined;
  /** The schema's history, which a move picks from. */
  revisions: SchemaRevision[];
  attributes: Record<string, unknown>;
  onSaved: () => Promise<void>;
}) {
  const root = useMemo(() => formRoot(schema ? schemaFields(schema) : []), [schema]);
  const stored = useMemo(() => draftFromAttributes(root, attributes), [root, attributes]);
  const form = useSchemaForm(root, stored, "edit");
  const patch = useMemo(
    () => attributesPatch(root, stored, form.draft),
    [root, stored, form.draft],
  );
  const save = useSubmit(async () => {
    try {
      await api.updateUser(userId, { attributes: patch });
    } catch (cause) {
      form.applyServerError(cause);
      throw cause;
    }
    await onSaved();
  }, "Could not save the user.");
  const dirty = Object.keys(patch).length > 0;
  // The server refuses any save while one is missing, and a save here can't add it.
  const unwritable = useMemo(
    () => unwritableMessage(unwritableRequired(root, form.draft, "edit"), "set it"),
    [root, form.draft],
  );
  const name = schema && schemaId ? schemaDisplayName(schema, schemaId) : undefined;
  // Being on an older revision is normal during a rollout, not an error, so this
  // says what is available rather than ranking the user's revision. The newest may
  // not be the one a release serves, which is why it never reads "outdated".
  const newerRevision =
    latestSchemaId !== undefined && ownRevisionId !== undefined && latestSchemaId !== ownRevisionId;

  return (
    <DetailSection
      title="User schema"
      aside={
        schema &&
        schemaId && (
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            {name !== schemaId && (
              // The name is the schema, so it opens the newest revision; the
              // box beside it is the revision this user is on. `min-h-6` is
              // the 24px touch target, the box's own height.
              <Link
                to="/schemas/$schemaId"
                params={{ schemaId: latestSchemaId ?? schemaId }}
                className={`text-foreground inline-flex min-h-6 min-w-0 items-center break-words underline-offset-2 hover:underline ${FIELD_LABEL_TYPOGRAPHY}`}
              >
                {name}
              </Link>
            )}
            <RevisionLink schemaId={schemaId} name={name} />
            {newerRevision && <Badge variant="warning">New revision available</Badge>}
            {ownRevisionId && (
              <RevisionBadges revisions={revisions} latestId={latestSchemaId} id={ownRevisionId} />
            )}
          </div>
        )
      }
      action={
        schema &&
        ownRevisionId &&
        revisions.length > 1 && (
          <UserRevisionSheet
            userId={userId}
            attributes={attributes}
            currentId={ownRevisionId}
            currentSchema={schema}
            latestId={latestSchemaId}
            revisions={revisions}
            discardsEdits={dirty}
            onUpdated={onSaved}
          >
            <Button type="button" variant="secondary" size="sm" className={CARD_ACTION_BUTTON}>
              {newerRevision ? "Review update" : "Change revision"}
            </Button>
          </UserRevisionSheet>
        )
      }
    >
      {root.fields.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {schema
            ? "This schema defines no attributes that can be shown."
            : "This user’s schema could not be read, so its attributes cannot be labelled."}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (form.attemptSubmit()) void save.run();
          }}
        >
          <FieldGroup className="gap-4">
            <SchemaFields
              root={root}
              draft={form.draft}
              onChange={form.setDraft}
              form={form.controls}
              layout={PROFILE_LAYOUT}
              // The reload after a save resets the draft, so an edit made
              // meanwhile would be lost.
              disabled={save.pending}
            />
          </FieldGroup>
          <FormError message={unwritable} />
          <FormError message={save.error} />
          <div className="flex justify-end">
            {/* Secondary, small: the resting Save is the secondary fill, which
                `disabled:opacity-50` dims — as `RenameCard`'s. Full width on
                a phone, as the design's mobile frame draws it. */}
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="gap-1 px-2.5 text-xs max-sm:w-full"
              disabled={!dirty}
              loading={save.pending}
            >
              Save
            </Button>
          </div>
        </form>
      )}
    </DetailSection>
  );
}
