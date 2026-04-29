"use client";

import {
  resolveZitadelRuntime,
  resolveZitadelRuntimeEnv,
  ZitadelRuntimeError,
  type ZitadelEnvironment,
  type ZitadelFlowPurpose,
  type ZitadelRuntime,
} from "@zitadel-nextgen/sdk-core";
import { type FC, useMemo } from "react";

import { ZitadelFlowMock } from "./mock.js";
import { ZitadelFlowReal } from "./real.js";
import { styles } from "./styles.js";

export {
  resolveZitadelRuntime,
  resolveZitadelRuntimeEnv,
  ZitadelRuntimeError,
} from "@zitadel-nextgen/sdk-core";
export type {
  ZitadelEnvironment,
  ZitadelFlowPurpose,
  ZitadelRuntime,
} from "@zitadel-nextgen/sdk-core";

export type ZitadelFlowProps = {
  purpose: ZitadelFlowPurpose;
  projectId?: string;
  issuer?: string;
  environment?: ZitadelEnvironment;
};

type RuntimeResolution =
  | { runtime: ZitadelRuntime; runtimeError?: undefined; useMock?: false }
  | { runtime?: undefined; runtimeError: Error; useMock?: false }
  | { runtime?: undefined; runtimeError?: undefined; useMock: true };

function ZitadelFlowRuntimeError({ message }: { message: string }) {
  return (
    <div role="alert" style={styles.error}>
      <strong>Zitadel runtime misconfigured</strong>
      <p style={styles.errorMessage}>{message}</p>
    </div>
  );
}

function resolveRuntimeFromProps(props: ZitadelFlowProps): RuntimeResolution {
  try {
    if (props.projectId || props.environment || props.issuer) {
      return {
        runtime: resolveZitadelRuntime({
          projectId: props.projectId,
          environment: props.environment,
          issuer: props.issuer,
        }),
      };
    }
    return { runtime: resolveZitadelRuntimeEnv() };
  } catch (error) {
    const runtimeError = error instanceof Error ? error : new Error(String(error));
    if (props.environment === undefined && runtimeError instanceof ZitadelRuntimeError) {
      return { useMock: true };
    }
    return { runtimeError };
  }
}

function ZitadelFlowImpl(props: ZitadelFlowProps) {
  const resolution = useMemo(
    () => resolveRuntimeFromProps(props),
    [props.environment, props.issuer, props.projectId],
  );
  if (resolution.runtimeError) {
    if (!(resolution.runtimeError instanceof ZitadelRuntimeError)) throw resolution.runtimeError;
    return <ZitadelFlowRuntimeError message={resolution.runtimeError.message} />;
  }
  if (resolution.useMock || resolution.runtime.environment === "development") {
    return <ZitadelFlowMock purpose={props.purpose} />;
  }
  return <ZitadelFlowReal purpose={props.purpose} runtime={resolution.runtime} />;
}

export const ZitadelFlow: FC<ZitadelFlowProps> & {
  Mock: typeof ZitadelFlowMock;
  Real: typeof ZitadelFlowReal;
} = Object.assign(ZitadelFlowImpl, { Mock: ZitadelFlowMock, Real: ZitadelFlowReal });
