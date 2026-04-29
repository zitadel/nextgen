"use client";

import dynamic from "next/dynamic";

const NextgenLoginWidget = dynamic(
  () => import("./nextgen-login-widget").then((m) => m.NextgenLoginWidget),
  { ssr: false },
);

export function LoginPage() {
  return <NextgenLoginWidget />;
}
