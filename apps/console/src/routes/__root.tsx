import { TanStackDevtools } from "@tanstack/react-devtools";
import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import "../styles.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <header>
        <h1>@zitadel-nextgen/ui-react</h1>
        <nav aria-label="Playground">
          <Link to="/" activeOptions={{ exact: true }}>
            Atoms
          </Link>
        </nav>
      </header>
      <main>
        <div className="playground-host">
          <Outlet />
        </div>
      </main>
      <TanStackDevtools
        config={{
          position: "bottom-right",
        }}
        plugins={[
          {
            name: "TanStack Router",
            render: <TanStackRouterDevtoolsPanel />,
          },
        ]}
      />
    </>
  );
}
