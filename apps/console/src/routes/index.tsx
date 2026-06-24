import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <section className="console-welcome">
      <h2>Console</h2>
      <p>
        The Zitadel console is where users manage their account and settings. This shell is the
        starting point for that app.
      </p>
      <p className="console-welcome__hint">
        Component development and review now live in Storybook (<code>moon run storybook:dev</code>
        ).
      </p>
    </section>
  );
}
