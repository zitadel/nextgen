import { createFileRoute } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";

import { ComingSoon } from "../../../components/coming-soon";

/**
 * Sessions.
 *
 * **The screen was built against an endpoint that does not work.** `GET
 * /sessions` is routed, documented and generated, but `sessionService.List` is a
 * stub returning `ErrNotImplemented` (`internal/service/session.go`), so every
 * load answered 501 and the sidebar link landed on the error boundary. This was
 * the only console screen that failed outright.
 *
 * It has also lost its `staticData.nav` entry, so the sidebar no longer offers a
 * destination that cannot load. Both come back together when #699 lands.
 *
 * The table below is parked rather than deleted, and is close to complete:
 * `revokeSession` is fully implemented server-side, so the only missing piece is
 * the list itself. Restore it, put the nav entry back, and check the columns
 * against whatever shape `List` actually returns — this markup was written
 * against the generated type, not against a response anyone has seen.
 */
export const Route = createFileRoute("/_authed/sessions/")({
  component: SessionsPlaceholder,
});

function SessionsPlaceholder() {
  return (
    <ComingSoon
      title="Sessions"
      description="Listing sessions needs an endpoint that is routed but not implemented — POST /sessions/query answers 501 today. Revoking already works, so this screen returns as soon as the list does."
      icon={KeyRound}
    />
  );
}

// --- Parked: the sessions table (see the note above) -------------------------
//
// import { useRouter } from "@tanstack/react-router";
// import { Button, Pill } from "@zitadel/ui-react";
// import { useState } from "react";
//
// import { api } from "../../../api/zitadel";
// import { getConsoleProjectId } from "../../../runtime/runtime";
// import { Page } from "../../../components/layout";
// import { DataTable, PageHeader } from "../../../components/resource-page";
//
// export const Route = createFileRoute("/_authed/sessions/")({
//   staticData: { nav: { label: "Sessions", order: 6, icon: KeyRound } },
//   loader: () => api.listSessions({ project_id: getConsoleProjectId() }),
//   component: SessionsList,
// });
//
// function SessionsList() {
//   const { sessions } = Route.useLoaderData();
//   const router = useRouter();
//   const [revoking, setRevoking] = useState<string | null>(null);
//
//   async function revoke(sessionId: string) {
//     setRevoking(sessionId);
//     try {
//       await api.revokeSession(sessionId, { project_id: getConsoleProjectId() });
//       await router.invalidate();
//     } catch (error) {
//       console.error("Failed to revoke session", error);
//     } finally {
//       setRevoking(null);
//     }
//   }
//
//   return (
//     <Page>
//       <PageHeader title="Sessions" />
//       <DataTable
//         rows={sessions}
//         getRowKey={(session) => session.session_id}
//         emptyMessage="No active sessions."
//         columns={[
//           { header: "Session", cell: (session) => session.session_id },
//           { header: "User", cell: (session) => session.user_id ?? "anonymous" },
//           {
//             header: "State",
//             cell: (session) => (
//               <Pill tone={session.state === "active" ? "success" : "neutral"}>{session.state}</Pill>
//             ),
//           },
//           { header: "Created", cell: (session) => session.created_at },
//           { header: "Expires", cell: (session) => session.expires_at },
//           {
//             header: "",
//             cell: (session) => (
//               <Button
//                 hierarchy="text"
//                 size="small"
//                 loading={revoking === session.session_id}
//                 onClick={() => void revoke(session.session_id)}
//               >
//                 Revoke
//               </Button>
//             ),
//           },
//         ]}
//       />
//     </Page>
//   );
// }
