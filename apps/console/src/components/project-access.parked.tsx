// Parked with the Projects block in the Add user drawer. Two reasons, and both
// have to clear before it comes back:
//
//   1. Design removed the project selector from the MVP (design decisions log
//      D6, 2026-07-31). It is expected to return in a future version, which is
//      why this is parked rather than deleted.
//   2. The backend cannot grant access anyway: roles need ADR 034's app-group
//      catalog (epic #419), and `queryProjects` is scope-pinned to a single
//      project until root ADR 053's authorized-project query lands.
//
// The component and these specs are kept intact — un-comment this file, the
// block in `add-user-sheet.tsx` and the parked cases in its spec together when
// design reinstates the block and the endpoints exist.
//
// import { render, screen } from "@testing-library/react";
// import userEvent from "@testing-library/user-event";
// import { describe, expect, it, vi } from "vitest";
//
// import { ProjectAccess, type ProjectAccessRow } from "./project-access";
//
// const PROJECTS = [
//   { id: "proj_river", name: "River" },
//   { id: "proj_atlas", name: "Atlas" },
// ];
//
// /**
//  * The roles multi-select cannot be exercised through the app: no endpoint serves
//  * a role catalogue (ADR 034 / #419), so `availableRoles` is empty in production.
//  * These tests drive the component directly with the design's role list so the
//  * mechanism the design specifies — pills, accumulating checkmarks, a menu that
//  * stays open — is verified rather than assumed.
//  */
// const ROLES = ["Buyer", "Seller", "Viewer", "Support agent", "Admin"];
//
// function setup(rows: ProjectAccessRow[] = [{ roles: [] }], roles: string[] = ROLES) {
//   const onChange = vi.fn();
//   render(
//     <ProjectAccess projects={PROJECTS} rows={rows} onChange={onChange} availableRoles={roles} />,
//   );
//   return { onChange };
// }
//
// describe("project access block", () => {
//   it("marks the chosen project with an accent fill, not a tick", async () => {
//     // `Row · River` in the library fills the chosen row with `base/accent`;
//     // unlike the schema list, it carries no Check glyph.
//     const { onChange } = setup([{ projectId: "proj_river", roles: [] }]);
//
//     await userEvent.click(screen.getByRole("combobox", { name: "Select project" }));
//     const river = await screen.findByRole("option", { name: "River" });
//     expect(river.className).toContain("bg-accent");
//     expect(screen.getByRole("option", { name: "Atlas" }).className).not.toContain("bg-accent");
//     expect(onChange).not.toHaveBeenCalled();
//   });
//
//   it("renders a Box glyph on every project row", async () => {
//     setup();
//     await userEvent.click(screen.getByRole("combobox", { name: "Select project" }));
//     for (const name of ["River", "Atlas"]) {
//       const row = await screen.findByRole("option", { name });
//       expect(row.querySelector("svg.lucide-box")).not.toBeNull();
//     }
//   });
//
//   it("accumulates role selections without closing the menu", async () => {
//     const rows: ProjectAccessRow[] = [{ projectId: "proj_river", roles: [] }];
//     const onChange = vi.fn();
//     const { rerender } = render(
//       <ProjectAccess
//         projects={PROJECTS}
//         rows={rows}
//         onChange={onChange}
//         availableRoles={ROLES}
//       />,
//     );
//
//     await userEvent.click(screen.getByRole("combobox", { name: "Select roles" }));
//     await userEvent.click(await screen.findByRole("option", { name: "Buyer" }));
//     expect(onChange).toHaveBeenCalledWith([{ projectId: "proj_river", roles: ["Buyer"] }]);
//
//     // The menu must still be open so a second role can be added — the design's
//     // "Menu stays open, checkmarks accumulate".
//     expect(screen.getByRole("option", { name: "Seller" })).toBeInTheDocument();
//
//     rerender(
//       <ProjectAccess
//         projects={PROJECTS}
//         rows={[{ projectId: "proj_river", roles: ["Buyer"] }]}
//         onChange={onChange}
//         availableRoles={ROLES}
//       />,
//     );
//     await userEvent.click(screen.getByRole("option", { name: "Seller" }));
//     expect(onChange).toHaveBeenLastCalledWith([
//       { projectId: "proj_river", roles: ["Buyer", "Seller"] },
//     ]);
//   });
//
//   it("shows a removable pill per selected role", async () => {
//     const onChange = vi.fn();
//     render(
//       <ProjectAccess
//         projects={PROJECTS}
//         rows={[{ projectId: "proj_river", roles: ["Buyer", "Seller"] }]}
//         onChange={onChange}
//         availableRoles={ROLES}
//       />,
//     );
//
//     const trigger = screen.getByRole("combobox", { name: "Select roles" });
//     expect(trigger).toHaveTextContent("Buyer");
//     expect(trigger).toHaveTextContent("Seller");
//
//     // Removing via the pill must not also open the popover.
//     await userEvent.click(screen.getByRole("button", { name: "Remove Buyer" }));
//     expect(onChange).toHaveBeenCalledWith([{ projectId: "proj_river", roles: ["Seller"] }]);
//     expect(screen.queryByRole("option", { name: "Viewer" })).not.toBeInTheDocument();
//   });
//
//   it("keeps roles unreachable until a project is chosen", async () => {
//     setup([{ roles: [] }]);
//     const roles = screen.getByRole("combobox", { name: "Select roles" });
//     expect(roles).toHaveAttribute("aria-disabled", "true");
//     await userEvent.click(roles);
//     expect(screen.queryByRole("option")).not.toBeInTheDocument();
//   });
//
//   it("opens empty when no role catalogue is supplied (the production case)", async () => {
//     setup([{ projectId: "proj_river", roles: [] }], []);
//     await userEvent.click(screen.getByRole("combobox", { name: "Select roles" }));
//     expect(await screen.findByText("No roles available.")).toBeInTheDocument();
//     expect(screen.queryAllByRole("option")).toHaveLength(0);
//   });
// });
