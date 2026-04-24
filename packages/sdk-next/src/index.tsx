"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  resolveZitadelRuntimeEnv,
  ZitadelRuntimeError,
  type ZitadelAuthMode,
  type ZitadelRuntime,
} from "@zitadel/sdk-core";

import { ZitadelAuthMock } from "./mock";
import { ZitadelAuthReal } from "./real";

export { resolveZitadelRuntimeEnv, ZitadelRuntimeError } from "@zitadel/sdk-core";
export type { ZitadelEnvironment, ZitadelRuntime, ZitadelSecretKind } from "@zitadel/sdk-core";

type ZitadelContextValue = {
  runtime: ZitadelRuntime | undefined;
  runtimeError: Error | undefined;
};

const ZitadelContext = createContext<ZitadelContextValue>({ runtime: undefined, runtimeError: undefined });

export function ZitadelProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ZitadelContextValue>(() => {
    try {
      return { runtime: resolveZitadelRuntimeEnv(), runtimeError: undefined };
    } catch (error) {
      return {
        runtime: undefined,
        runtimeError: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }, []);
  return <ZitadelContext.Provider value={value}>{children}</ZitadelContext.Provider>;
}

function useZitadelRuntime(): ZitadelContextValue {
  return useContext(ZitadelContext);
}

export function ZitadelAuth({ mode, title }: { mode: ZitadelAuthMode; title?: string }) {
  const { runtime, runtimeError } = useZitadelRuntime();
  if (!runtime) {
    if (runtimeError && !(runtimeError instanceof ZitadelRuntimeError)) {
      throw runtimeError;
    }
    return <ZitadelAuthMock mode={mode} title={title} />;
  }
  if (runtime.environment === "development") {
    return <ZitadelAuthMock mode={mode} title={title} />;
  }
  return <ZitadelAuthReal mode={mode} title={title} runtime={runtime} />;
}

ZitadelAuth.Mock = ZitadelAuthMock;
ZitadelAuth.Real = ZitadelAuthReal;
