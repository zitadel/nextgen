import { createFileRoute, redirect } from "@tanstack/react-router";
import { Settings } from "lucide-react";

/**
 * The project's Settings row: the last of the project's list, and the way into
 * its own list (D37), as the root Settings row is above every project (D29).
 *
 * It has no page of its own: it forwards to the list's first page, General.
 */
export const Route = createFileRoute("/_authed/project/")({
  // Last: the list above it is the project's contents, this is the project.
  staticData: {
    scope: "project",
    nav: { label: "Settings", order: 10, icon: Settings },
  },
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/project/general", search, replace: true });
  },
});
