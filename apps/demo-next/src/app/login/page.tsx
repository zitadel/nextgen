import { auth } from "@zitadel/sdk-next/server";
import { redirect } from "next/navigation";
import { LoginWidget } from "./widget";

export default async function LoginPage() {
  const session = await auth();
  if (session.isAuthenticated) redirect("/admin");
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#f3f4f6",
      }}
    >
      <LoginWidget />
    </main>
  );
}
