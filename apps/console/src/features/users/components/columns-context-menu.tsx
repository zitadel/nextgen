import { Fragment, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ColumnPins } from "@/features/users/column-pins";
import type { ColumnGroup } from "@/features/users/list";

/**
 * The Columns menu, opened by right-clicking the table (a long press on touch,
 * the context-menu key or Shift+F10 on a focused control in it): a checkbox
 * per schema property, pinning it as its own column. Grouped under each
 * schema's title when the loaded users mix schemas, since a pin belongs to one
 * schema's property.
 *
 * Selecting an item keeps the menu open, so several can be pinned in one go.
 * With nothing to offer, the table keeps the browser's own menu.
 */
export function ColumnsContextMenu({
  groups,
  pins,
  onToggle,
  children,
}: {
  groups: ColumnGroup[];
  pins: ColumnPins;
  onToggle: (schemaId: string, key: string) => void;
  children: ReactNode;
}) {
  if (groups.length === 0) return children;
  const grouped = groups.length > 1;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="max-h-[min(24rem,var(--radix-context-menu-content-available-height))] w-56">
        <ContextMenuLabel>Columns</ContextMenuLabel>
        {groups.map((group) => (
          <Fragment key={group.schemaId}>
            <ContextMenuSeparator />
            {grouped && (
              <ContextMenuLabel className="text-muted-foreground truncate text-xs font-normal">
                {group.title}
              </ContextMenuLabel>
            )}
            {group.fields.map((entry) => (
              <ContextMenuCheckboxItem
                key={entry.key}
                checked={pins[group.schemaId]?.includes(entry.key) ?? false}
                onCheckedChange={() => onToggle(group.schemaId, entry.key)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="truncate">{entry.label}</span>
              </ContextMenuCheckboxItem>
            ))}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * A right-click on a link keeps the browser's own menu (open in a new tab,
 * copy the link) rather than the Columns menu: stopping the event here, under
 * the trigger, never prevents its default.
 */
export function keepLinkMenu(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest("a")) event.stopPropagation();
}

/**
 * The same for a long press on touch or pen, which the trigger opens from its
 * own timer on `pointerdown` rather than from `contextmenu`: a press on a
 * link never starts it, so only the browser's link menu opens.
 */
export function keepLinkPress(event: PointerEvent) {
  if (event.pointerType !== "mouse") keepLinkMenu(event);
}
