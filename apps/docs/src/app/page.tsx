import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        ZITADEL NextGen Documentation
      </h1>
      <p className="max-w-2xl text-lg text-fd-muted-foreground">
        API reference, guides, and tutorials for the next generation of the
        ZITADEL identity platform.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
        >
          Guides
        </Link>
        <Link
          href="/api"
          className="rounded-lg border border-fd-border px-6 py-3 text-sm font-medium transition-colors hover:bg-fd-accent"
        >
          API Reference
        </Link>
      </div>
    </main>
  );
}
