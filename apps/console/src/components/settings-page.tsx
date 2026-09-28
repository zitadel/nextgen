import type { ReactNode } from "react";

/**
 * The Settings page frame shared by Profile and Members (Figma `Settings Page /
 * Profile` 1556:87256, `Admins` 2097:7271, mobile 1718:21347): a 704px column
 * centred in the content area, 32px from the top and 16px in from the sides on
 * mobile; a header band (`Pro Blocks / Page Header / settings`) 76px tall on
 * desktop and 64px on mobile, with the title in the display face at 24px and
 * an optional trailing action.
 */
export function SettingsPage({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-4 pt-8 pb-8">
      <div className="mx-auto w-full max-w-[704px]">
        <div className="flex h-16 items-center justify-between gap-4 sm:h-[76px]">
          <h1 className="font-serif text-2xl leading-none text-foreground">{title}</h1>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}
