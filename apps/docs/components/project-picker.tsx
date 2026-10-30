"use client";
import type {
  ListMyProjects200 as ProjectPage,
  ListMyProjects200ProjectsItem,
} from "@zitadel/api/generated/model";
import { useServer } from "fumadocs-openapi";
import {
  type OperationParameter,
  useExampleRequests,
  useOperation,
} from "fumadocs-openapi/operation";
import { Custom } from "fumadocs-openapi/ui/playground/client";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

type Project = Pick<ListMyProjects200ProjectsItem, "id" | "name">;

interface Selection {
  owner: string;
  project: Project;
}

const SelectionsContext = createContext<{
  selections: Record<string, Selection | undefined>;
  remember: (key: string, selection: Selection | undefined) => void;
} | null>(null);

// Keep the owner of a picked value across closing the playground or changing
// auth. On a later account change, only that value is cleared, not other edits.
export function ProjectPickerProvider({ children }: { children: ReactNode }) {
  const [selections, setSelections] = useState<Record<string, Selection | undefined>>({});
  const remember = useCallback(
    (key: string, selection: Selection | undefined) =>
      setSelections((before) => ({ ...before, [key]: selection })),
    [],
  );
  const value = useMemo(() => ({ selections, remember }), [selections, remember]);
  return <SelectionsContext value={value}>{children}</SelectionsContext>;
}

interface PickerProps {
  user: { user_id: string } | null | undefined;
  beforeRequest: (init: RequestInit) => Promise<RequestInit>;
}

/** Rendered by the session auth provider, so bearer auth keeps manual inputs. */
export function SessionProjectPicker(props: PickerProps) {
  const { path, parameters } = useOperation();
  // On self-service endpoints this parameter asserts the session's home,
  // rather than choosing a project to manage (session-project-id.yaml).
  if (/^\/(users|sessions)\/me(?:\/|$)/.test(path)) return null;
  const parameter = parameters
    .flatMap((group) => group.items)
    .find((param) => param.name === "project_id" && (param.in === "query" || param.in === "path"));
  return parameter ? <ProjectPicker {...props} parameter={parameter} /> : null;
}

function ProjectPicker({
  user,
  beforeRequest,
  parameter,
}: PickerProps & { parameter: OperationParameter }) {
  const { method, path } = useOperation();
  const { selected: example } = useExampleRequests();
  const { resolveUrl } = useServer();
  const { value, setValue } = Custom.useController([parameter.in, parameter.name]);
  const context = use(SelectionsContext);
  if (!context) throw new Error("ProjectPicker requires ProjectPickerProvider");
  const { selections, remember } = context;
  const key = `${method} ${path} ${example} ${parameter.in}`;
  const picked = selections[key];
  const owner = user?.user_id;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [page, setPage] = useState<ProjectPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [accountChanged, setAccountChanged] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const searchId = useId();
  const target = resolveUrl("/users/me/projects");
  const sameOrigin =
    typeof window !== "undefined" && new URL(target).origin === window.location.origin;

  useEffect(() => {
    if (!picked || picked.owner === owner) return;
    if (value === picked.project.id) {
      setValue(undefined);
      setAccountChanged(true);
    }
    remember(key, undefined);
  }, [key, owner, picked, remember, setValue, value]);

  useEffect(() => {
    // An account's results must never remain visible under another account.
    setOpen(false);
    setQuery("");
    setCursor(undefined);
    setPage(undefined);
  }, [owner, target]);

  useEffect(() => {
    if (!open || !owner || !sameOrigin) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    if (!cursor) setPage(undefined);
    const timer = window.setTimeout(
      async () => {
        const timeout = AbortSignal.timeout(10_000);
        try {
          const url = new URL(target);
          url.searchParams.set("limit", "20");
          if (query.trim()) url.searchParams.set("name_contains", query.trim());
          if (cursor) url.searchParams.set("page_token", cursor);
          // Uses the same account check as Send. No target project_id: on this
          // endpoint it would constrain the session's home, not the results.
          const init = await beforeRequest({
            method: "GET",
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, timeout]),
          });
          const response = await fetch(url, init);
          const next: ProjectPage | undefined = response.ok ? await response.json() : undefined;
          if (controller.signal.aborted) return;
          if (!next) {
            setError(`Projects could not be loaded (${response.status}).`);
            return;
          }
          setPage((previous) => ({
            ...next,
            projects: cursor ? [...(previous?.projects ?? []), ...next.projects] : next.projects,
          }));
        } catch {
          if (controller.signal.aborted) return;
          // Not the browser's wording ("Failed to fetch", "signal timed out"),
          // which reads as no sentence beside the hint below.
          setError(
            timeout.aborted ? "Projects took too long to load." : "Projects could not be loaded.",
          );
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      query.trim() && !cursor ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [beforeRequest, cursor, open, owner, query, retry, sameOrigin, target]);

  if (!user || !sameOrigin) return null;
  const current =
    picked && picked.owner === owner && picked.project.id === value ? picked.project : undefined;
  function choose(project?: Project) {
    if (!owner) return;
    setValue(project?.id);
    remember(key, project ? { owner, project } : undefined);
    setAccountChanged(false);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="border-b px-4 py-3 text-xs last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Target project</span>
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setCursor(undefined);
            setPage(undefined);
            setOpen(!open);
          }}
          className="rounded-md border px-3 py-1.5 text-start hover:bg-fd-accent focus-visible:outline-2"
        >
          {current ? `${current.name} · ${current.id}` : "Choose project…"}
        </button>
        {!parameter.required && (
          <button type="button" className="underline" onClick={() => choose()}>
            Use session’s project
          </button>
        )}
      </div>
      <p className="mt-2 text-fd-muted-foreground">
        {value === undefined && !parameter.required
          ? "Using the signed-in session’s project."
          : "Choose a project you can access, or enter its ID in the request below."}
      </p>
      {/* Until a project is set again, picked or entered by hand. */}
      {accountChanged && value === undefined && (
        <p role="status" className="mt-2">
          Your account changed. Choose a project again.
        </p>
      )}
      {open && (
        <div id={panelId} className="mt-3 space-y-2">
          <label htmlFor={searchId}>Search your projects</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(undefined);
            }}
            className="w-full rounded-md border bg-fd-background px-3 py-2 focus-visible:outline-2"
          />
          {loading && <p role="status">Loading projects…</p>}
          {error && (
            <div role="alert">
              <p>{error} You can still enter an ID manually.</p>
              <button type="button" className="underline" onClick={() => setRetry(retry + 1)}>
                Retry
              </button>
            </div>
          )}
          {!loading && !error && page?.projects.length === 0 && (
            <p role="status">
              {query.trim() ? "No matching projects." : "No accessible projects."}
            </p>
          )}
          <ul aria-label="Your projects" className="max-h-64 overflow-auto">
            {page?.projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => choose(project)}
                  className="flex w-full flex-col rounded-md px-3 py-2 text-start hover:bg-fd-accent focus-visible:outline-2"
                >
                  <span className="font-medium">{project.name}</span>
                  <span className="font-mono text-fd-muted-foreground">{project.id}</span>
                </button>
              </li>
            ))}
          </ul>
          {page?.next_page_token && (
            <button
              type="button"
              disabled={loading}
              className="underline disabled:opacity-50"
              onClick={() => setCursor(page.next_page_token ?? undefined)}
            >
              Load more projects
            </button>
          )}
        </div>
      )}
    </div>
  );
}
