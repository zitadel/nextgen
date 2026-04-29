"use client";

import "@nextgen/ui-lit";

export function NextgenLoginWidget() {
  return (
    <nextgen-login
      proxy-base="/__nextgen"
      onNextgen-signin={(e: Event) => {
        const detail = (e as CustomEvent).detail;
        console.log("signed in", detail);
        window.location.href = "/dashboard";
      }}
    />
  );
}
