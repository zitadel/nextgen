export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
        Zitadel preview cloud
      </p>
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Identity infrastructure for the next generation of applications.
      </h1>
      <p className="max-w-xl text-base text-neutral-600 dark:text-neutral-300">
        This is the start page of the preview cloud. The website is on its way; the documentation
        and the console are already here.
      </p>
      <nav aria-label="Primary" className="flex flex-wrap items-center justify-center gap-4">
        <a
          href="/docs"
          className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Read the docs
        </a>
        <a
          href="/console"
          className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium transition hover:border-neutral-500 dark:border-neutral-700 dark:hover:border-neutral-400"
        >
          Open the console
        </a>
      </nav>
    </main>
  );
}
