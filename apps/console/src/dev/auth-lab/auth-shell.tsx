/**
 * The reusable frame every auth-lab screen sits in, and the small pieces the
 * approved Figma login blocks repeat (`✅ Login` page, `Blocks / sign*`).
 *
 * Everything composes the console's shadcn components; the class strings here
 * are only the places where the Figma block differs from the registry default.
 * They are applied at this call site rather than in `components/ui/*`, so the
 * lab never changes the console.
 */

import { ZITADEL_ATTRIBUTION_LOGOTYPE_SVG } from "@zitadel/components";
import { CircleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { FigmaIcons } from "@/components/figma-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import googleGlyph from "./assets/google-g.svg";
import logoPlaceholder from "./assets/logo-placeholder.svg";

/**
 * Figma fills a login input with `background` plus the `input-fill` tint
 * (dark: 4.5% white, light: none) — the same token the `<zl-field>` atom uses.
 * The console `Input` stops at `bg-background`.
 */
const AUTH_INPUT = "bg-[linear-gradient(var(--zl-input-fill),var(--zl-input-fill))]";

/** Card title: display face, 20px, leading-none, regular (APK Futural has one weight). */
const AUTH_TITLE = "font-serif text-xl leading-none font-normal";

/**
 * The page a block renders on: `background`, content centred, 24px between the
 * card and the trustmark. Figma pads 40px on the 1280 frame; the 360 frame
 * insets the card 24px, so the padding follows the frame's width, not the
 * browser's (`@container`), which keeps the lab's mobile frame honest.
 */
export function AuthShell({
  children,
  logo = false,
  trustmark = true,
}: {
  children: ReactNode;
  /** The `Logo` lockup above the card (only the `Sign up — with logo` frame has it). */
  logo?: boolean;
  /** The "Secured with Zitadel" row under the card (absent on the passkey block). */
  trustmark?: boolean;
}) {
  return (
    <div className="bg-background text-foreground @container/auth flex min-h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 @md/auth:p-10">
        {logo ? (
          <div className="flex w-full max-w-96 flex-col gap-8">
            <BrandLogo />
            {children}
          </div>
        ) : (
          children
        )}
        {trustmark && <Trustmark />}
      </div>
    </div>
  );
}

/** Card + header. `description` is the muted line the passkey block adds. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="w-full max-w-96">
      <CardHeader className="flex flex-col gap-1.5">
        <CardTitle className={AUTH_TITLE}>{title}</CardTitle>
        {description && <CardDescription className="leading-5">{description}</CardDescription>}
      </CardHeader>
      {children}
    </Card>
  );
}

export function AuthInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input className={cn(AUTH_INPUT, className)} {...props} />;
}

/** Password label row; Figma pins "Forgot your password?" to its top-right. */
export function PasswordLabel({ htmlFor, forgot = false }: { htmlFor: string; forgot?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <FieldLabel htmlFor={htmlFor}>Password</FieldLabel>
      {forgot && (
        <a
          href="#"
          onClick={(event) => event.preventDefault()}
          className="text-foreground text-sm leading-5"
        >
          Forgot your password?
        </a>
      )}
    </div>
  );
}

/**
 * "Don't have an account? Sign up" under the buttons.
 *
 * `tone="figma-override"` reproduces a raw `#737373` the library blocks paint
 * over their `muted-foreground` token; only the detached `Sign up — with logo`
 * frame uses the token itself. Kept as-is so the two sign-up variants can be
 * compared faithfully — it is a design decision still to make, not a token.
 */
export function FooterPrompt({
  prompt,
  action,
  href,
  tone = "figma-override",
}: {
  /** Lead-in text; omitted for a bare navigate action. */
  prompt?: string;
  action: string;
  href: string;
  tone?: "figma-override" | "token";
}) {
  return (
    <p
      className={cn(
        "text-center text-sm leading-5",
        tone === "token" ? "text-muted-foreground" : "text-[#737373]",
      )}
    >
      {prompt && `${prompt} `}
      <a href={href} className="underline">
        {action}
      </a>
    </p>
  );
}

/**
 * The inline alert from `Blocks / signinAlert`. The Alert differs from the
 * registry default: `muted` fill, 8px icon gap, and a display-face regular
 * title.
 */
export function AuthAlert({ title, description }: { title: string; description: string }) {
  return (
    <FigmaIcons>
      <Alert className="bg-muted has-[>svg]:gap-x-2">
        <CircleAlert />
        <AlertTitle className="truncate font-serif leading-5 font-normal tracking-normal">
          {title}
        </AlertTitle>
        <AlertDescription className="leading-5">{description}</AlertDescription>
      </Alert>
    </FigmaIcons>
  );
}

/**
 * SSO exploration — not in Figma. The provider block #1042 adds after the
 * step's actions: a divider, then one button per `sso_providers` entry
 * (label = provider `name`, glyph from its `template`). Deliberately minimal:
 * a plain rule (the "or continue with" copy is an open question in #1042) and
 * the approved `secondary` button, since brand styling is not decided.
 */
export function SsoProviders() {
  return (
    <>
      <FieldSeparator />
      <Button type="button" variant="secondary" className="w-full">
        <img src={googleGlyph} alt="" width={16} height={16} />
        Google
      </Button>
    </>
  );
}

/** "Secured with [Zitadel]  [Expires in 7 days]" — `Trustmark` in every block but passkey. */
function Trustmark() {
  return (
    <div className="flex w-full max-w-96 flex-wrap items-start justify-center gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-foreground text-sm leading-5">Secured with</span>
        <span
          role="img"
          aria-label="Zitadel"
          className="text-foreground flex h-4 w-[65px]"
          // The trustmark logotype the login surface already ships (currentColor,
          // 65×16) — the same glyphs as the Figma `Logotype` asset.
          dangerouslySetInnerHTML={{ __html: ZITADEL_ATTRIBUTION_LOGOTYPE_SVG }}
        />
      </div>
      <Badge variant="secondary">Expires in 7 days</Badge>
    </div>
  );
}

/**
 * The customer-logo placeholder from the `Sign up — with logo` frame: a 32px
 * hexagon (the Figma asset, verbatim — white at 85%, so it only reads on the
 * dark canvas the frame was drawn on) and "Your Logo" at 20px semibold. Figma
 * sets the wordmark in Inter, which the console does not load; it falls back to
 * the sans face.
 */
function BrandLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center">
        <img src={logoPlaceholder} alt="" width={27.7128} height={32} />
      </span>
      <span className="text-foreground font-['Inter',var(--zl-font-family-sans)] text-xl font-semibold">
        Your Logo
      </span>
    </div>
  );
}
