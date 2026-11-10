import { Badge } from "@/components/ui/badge";

/** The keyword that designates a property (ADR 058), named as the schema writes it. */
export function SchemaDesignationBadge({ designation }: { designation: string }) {
  return (
    <Badge variant="secondary" className="font-mono font-normal">
      {designation}
    </Badge>
  );
}
