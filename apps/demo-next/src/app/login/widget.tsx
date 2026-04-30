"use client";

import dynamic from "next/dynamic";

const NextgenLogin = dynamic(
  async () => {
    await import("@nextgen/ui-lit");
    return function NextgenLoginElement() {
      return <nextgen-login proxy-base="/__nextgen" post-sign-in-url="/admin" />;
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  return <NextgenLogin />;
}
