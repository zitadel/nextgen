import { Loader2, UserRound } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxPlaceholder,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { api } from "../api/zitadel";
import { describeError } from "../lib/api-error";
import { field } from "../lib/record";
import { userIdentifier, userIdentity } from "../lib/user";
import { getConsoleProjectId } from "../runtime/runtime";

/**
 * Give an existing person admin access to this project (#769).
 *
 * **The colleague must already have signed up.** A grant binds a `principal_id`,
 * so there is nobody to bind until the account exists — which is why this picks
 * from people rather than taking an email like the design's `Invite admin`
 * frame. #769 scopes it the same way: the signup link is shared separately, and
 * access is given afterwards.
 *
 * **The picker filters on the client.** `POST /users/query` has no filter field
 * for an identifier: the enum is `created_at`, `id`, `schema`, `status`,
 * `team_id` and `lifecycle_owner_team_id`, so an email cannot be resolved
 * server-side. One page of users is loaded and the Combobox's own search
 * narrows it, which is honest for a project whose people fit in a page and
 * wants a server-side filter before it does not.
 *
 * **People who are already admins are not offered.** `POST /grants` refuses a
 * second grant for the same principal and relation, so offering them is
 * offering a choice that cannot work. The refusal is still handled: the list of
 * existing admins is a snapshot, and somebody else can grant the same person
 * while this dialog is open.
 */
export function AddAdminDialog({
  children,
  onAdded,
  alreadyAdmins,
}: {
  children: ReactNode;
  onAdded: () => void;
  /** Principal ids that already hold an `admin` grant on this project. */
  alreadyAdmins: readonly string[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {/* 384px, matching the remove dialog and the frame. The important suffix
          beats the primitive's own `sm:max-w-lg`. */}
      <DialogContent className="sm:max-w-sm!">
        <DialogHeader>
          <DialogTitle>Add admin</DialogTitle>
          <DialogDescription>
            They get full administrative access to this project. They need to have signed up
            already.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted per opening so a cancelled attempt does not leave its
            selection, its error or its people list behind. */}
        {open && (
          <AddAdminForm
            alreadyAdmins={alreadyAdmins}
            onDone={() => {
              setOpen(false);
              onAdded();
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A person the picker offers. */
interface Person {
  id: string;
  /** What the row reads: the resolved display or identifier, else the id. */
  label: string;
  /** The second line, when the display and the identifier are different values. */
  description?: string;
}

function AddAdminForm({
  alreadyAdmins,
  onDone,
  onCancel,
}: {
  alreadyAdmins: readonly string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [people, setPeople] = useState<Person[] | undefined>(undefined);
  const [selected, setSelected] = useState<Person | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await api.queryUsers({ limit: PEOPLE_LIMIT });
        if (cancelled) return;
        const granted = new Set(alreadyAdmins);
        setPeople(page.users.map(toPerson).filter((person) => !granted.has(person.id)));
      } catch (cause) {
        if (cancelled) return;
        setPeople([]);
        setError(describeError(cause, "The people on this project could not be loaded."));
      }
    })();
    return () => {
      cancelled = true;
    };
    // The snapshot is taken once per opening: the dialog is remounted each time,
    // so a person granted since the last open is already excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api.createGrant(
        { principal_type: "user", principal_id: selected.id, relation: "admin" },
        { project_id: getConsoleProjectId() },
      );
      toast.success(`${selected.label} added`, {
        description: "They now have admin access to this project.",
      });
      onDone();
    } catch (cause) {
      // Includes the duplicate case: the API refuses a second identical
      // binding, and its own message says so better than console-authored copy.
      setError(describeError(cause, "The admin could not be added."));
    } finally {
      setSubmitting(false);
    }
  }

  const loading = people === undefined;

  return (
    <>
      <Combobox open={pickerOpen} onOpenChange={setPickerOpen}>
        <ComboboxAnchor asChild>
          <ComboboxTrigger
            label="Person"
            open={pickerOpen}
            disabled={loading}
            className="w-full"
            addon={<UserRound className="size-4" />}
            onOpen={() => setPickerOpen(true)}
          >
            {selected ? (
              <ComboboxValue>{selected.label}</ComboboxValue>
            ) : (
              <ComboboxPlaceholder>
                {loading ? "Loading people…" : "Select a person"}
              </ComboboxPlaceholder>
            )}
          </ComboboxTrigger>
        </ComboboxAnchor>
        <ComboboxContent
          options={(people ?? []).map((person) => ({
            value: person.id,
            label: person.label,
            description: person.description,
          }))}
          selected={selected ? [selected.id] : []}
          searchPlaceholder="Search people"
          emptyLabel={
            people?.length === 0
              ? "Everyone on this project is already an admin."
              : "Nobody found. They need to sign up first."
          }
          onSelect={(id) => setSelected((people ?? []).find((person) => person.id === id))}
          onClose={() => setPickerOpen(false)}
        />
      </Combobox>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={!selected || submitting}>
          {submitting && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Add admin
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * How many people the picker holds. One page, because the filtering is
 * client-side: a project with more people than this cannot reach the ones past
 * it, and the fix is a server-side identifier filter rather than a bigger
 * number.
 */
const PEOPLE_LIMIT = 100;

function toPerson(user: Record<string, unknown>): Person {
  const id = field(user, "id") ?? "";
  const identifier = userIdentifier(user);
  const label = userIdentity(user) ?? id;
  return {
    id,
    label,
    // Only when it adds something: a user whose display *is* the identifier
    // would otherwise render the same string twice.
    description: identifier && identifier !== label ? identifier : undefined,
  };
}
