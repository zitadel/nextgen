import { Logo } from "./logo";

// The page ends on the logo alone: the header carries the links.
export function SiteFooter() {
  return (
    <footer className="border-border-primary border-t">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Logo id="footer-logo" className="h-6 w-auto" />
      </div>
    </footer>
  );
}
