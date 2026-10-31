/**
 * The console's components an add-on screen is built from (Console ADR 0006
 * §3), imported as `@zitadel/console/addon/ui`: the settings screen's frame,
 * its sections and rows, the primitives inside them, and the sign-in screen,
 * so an add-on screen looks like the console's own. Each name here is a
 * promise to the add-on; add one when a screen needs it, never a whole folder.
 */
export { DETAIL_CARD, DETAIL_TITLE, DetailRow } from "@/components/detail-page";
export { FormError } from "@/components/form-error";
export { Page, SettingsColumn } from "@/components/layout";
export { SettingsCard, SettingsSection } from "@/components/settings-card";
export { SignInScreen } from "@/components/sign-in-screen";
export { PAGE_TITLE_ROW, PANEL_BODY_CELL, PANEL_HEAD_CELL } from "@/components/typography";
export { Badge } from "@/components/ui/badge";
export { Button } from "@/components/ui/button";
export { Card, CardContent } from "@/components/ui/card";
export {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
export { Input } from "@/components/ui/input";
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export { Switch } from "@/components/ui/switch";
export {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
export { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
export { Textarea } from "@/components/ui/textarea";
// The toast the console's root `Toaster` shows: the add-on must not bring its own.
export { toast } from "sonner";
