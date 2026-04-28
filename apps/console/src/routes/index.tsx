import { createComponent } from "@lit/react";
import { createFileRoute } from "@tanstack/react-router";
import { SimpleGreeting } from "@zitadel-nextgen/components";
import react from "react";

const SimpleGreetingComponent = createComponent({
  tagName: "simple-greeting",
  elementClass: SimpleGreeting,
  react,
});

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="p-8">
      <SimpleGreetingComponent name="Zitadel" />
      <h1 className="text-4xl font-bold">Welcome to TanStack Start</h1>
      <p className="mt-4 text-lg">
        Edit <code>src/routes/index.tsx</code> to get started.
      </p>
    </div>
  );
}
