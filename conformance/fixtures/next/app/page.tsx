// zitadel-cli: managed-file v1
import { redirect } from "next/navigation";

// A redirect is never an instant navigation: tell Next.js not to validate it.
export const instant = false;

export default function Home() {
  redirect("/login");
}
