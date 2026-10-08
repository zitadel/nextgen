import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Body copy under a `StandaloneMessage` title. */
export const STANDALONE_BODY = "text-muted-foreground text-sm";

/**
 * The shell-less screen: a centred column with nothing above it. Sign-in, the
 * claim page and the boot-time error all render outside the app shell; the
 * sign-in widget carries its own "Secured with" mark, so the screen draws none.
 */
export function StandaloneScreen({
  heading,
  children,
}: {
  /** A screen-reader-only `h1`, for screens whose visible title is not one. */
  heading?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      {heading && <h1 className="sr-only">{heading}</h1>}
      {children}
    </main>
  );
}

/** A titled message in the standalone column. */
export function StandaloneMessage({
  title,
  level = 2,
  className,
  children,
}: {
  title: string;
  /** `1` when the screen has no screen-reader-only heading above it. */
  level?: 1 | 2;
  className?: string;
  children: ReactNode;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={cn("flex max-w-md flex-col gap-3 text-center", className)}>
      <Heading className="text-foreground font-serif text-xl">{title}</Heading>
      {children}
    </div>
  );
}

/** The deployment has no project to sign in to; `children` says what to do next. */
export function NoProjectYet({ children }: { children: ReactNode }) {
  return (
    <StandaloneMessage title="No project yet">
      <p className={STANDALONE_BODY}>{children}</p>
    </StandaloneMessage>
  );
}
