"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

const NextgenLogin = dynamic(
  async () => {
    await import("@nextgen/ui-lit");
    return function NextgenLoginElement() {
      const ref = useRef<HTMLElement>(null);

      useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const handler = () => {
          window.location.href = "/admin";
        };
        el.addEventListener("nextgen-signin", handler);
        return () => el.removeEventListener("nextgen-signin", handler);
      }, []);

      return <nextgen-login ref={ref} proxy-base="/__nextgen" />;
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  return <NextgenLogin />;
}
