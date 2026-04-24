"use client";

import { createContext, type FC, type ReactNode, useContext, useMemo } from "react";
import {
  resolveZitadelRuntimeEnv,
  ZitadelRuntimeError,
  type ZitadelAuthMode,
  type ZitadelRuntime,
} from "@zitadel/sdk-core";

import { ZitadelAuthMock } from "./mock";
import { ZitadelAuthReal } from "./real";
import { styles } from "./styles";

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

type ZitadelAuthProps = { mode: ZitadelAuthMode; title?: string };

function ZitadelAuthRuntimeError({ message }: { message: string }) {
  return (
    <div role="alert" style={styles.error}>
      <strong>Zitadel runtime misconfigured</strong>
      <p style={styles.errorMessage}>{message}</p>
    </div>
  );
}

function ZitadelAuthImpl({ mode, title }: ZitadelAuthProps) {
  const { runtime, runtimeError } = useZitadelRuntime();
  if (runtimeError) {
    if (!(runtimeError instanceof ZitadelRuntimeError)) throw runtimeError;
    return <ZitadelAuthRuntimeError message={runtimeError.message} />;
  }
  if (!runtime || runtime.environment === "development") {
    return <ZitadelAuthMock mode={mode} title={title} />;
  }
  return <ZitadelAuthReal mode={mode} title={title} runtime={runtime} />;
}

export const ZitadelAuth: FC<ZitadelAuthProps> & {
  Mock: typeof ZitadelAuthMock;
  Real: typeof ZitadelAuthReal;
} = Object.assign(ZitadelAuthImpl, { Mock: ZitadelAuthMock, Real: ZitadelAuthReal });
