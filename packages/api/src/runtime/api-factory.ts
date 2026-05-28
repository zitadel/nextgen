/**
 * Factory that creates a typed API client with the base URL pre-bound.
 *
 * Every method delegates to the orval-generated function after setting
 * the module-level base URL. This keeps the generated code untouched
 * while giving consumers an explicit, non-global API surface.
 */
import { setApiBaseUrl } from "./base-url";
import {
  getOpenIDConfiguration,
  authorizeGet,
  authorizeDevice,
  endSession,
  introspect,
  getKeys,
  revokeToken,
  getToken,
  getUserInfo,
  getHealth,
  getLive,
  getReady,
  listUsers,
  createFlow,
  getFlowStep,
  submitFlowStep,
  submitFlowEvent,
  createAuthAttempt,
  getAuthAttempt,
  issueChallenge,
  verifyChallengeProof,
  createHandoff,
  createProject,
  getProject,
  createSession,
  listSessions,
  exchangeHandoff,
  getSession,
  revokeSession,
  getMySession,
  revokeMySession,
  createSchema,
  getSchemaById,
  createFlowDefinition,
  listFlowDefinitions,
  getFlowDefinition,
  updateFlowDefinition,
  deleteFlowDefinition,
  getEndSessionUrl,
} from "../generated/endpoints/zitadelNextGen";

/**
 * Typed API client returned by {@link createApi}. Every method mirrors
 * the orval-generated function with the same name and signature.
 */
export interface ZitadelApi {
  getOpenIDConfiguration: typeof getOpenIDConfiguration;
  authorizeGet: typeof authorizeGet;
  authorizeDevice: typeof authorizeDevice;
  endSession: typeof endSession;
  getEndSessionUrl: typeof getEndSessionUrl;
  introspect: typeof introspect;
  getKeys: typeof getKeys;
  revokeToken: typeof revokeToken;
  getToken: typeof getToken;
  getUserInfo: typeof getUserInfo;
  getHealth: typeof getHealth;
  getLive: typeof getLive;
  getReady: typeof getReady;
  listUsers: typeof listUsers;
  createFlow: typeof createFlow;
  getFlowStep: typeof getFlowStep;
  submitFlowStep: typeof submitFlowStep;
  submitFlowEvent: typeof submitFlowEvent;
  createAuthAttempt: typeof createAuthAttempt;
  getAuthAttempt: typeof getAuthAttempt;
  issueChallenge: typeof issueChallenge;
  verifyChallengeProof: typeof verifyChallengeProof;
  createHandoff: typeof createHandoff;
  createProject: typeof createProject;
  getProject: typeof getProject;
  createSession: typeof createSession;
  listSessions: typeof listSessions;
  exchangeHandoff: typeof exchangeHandoff;
  getSession: typeof getSession;
  revokeSession: typeof revokeSession;
  getMySession: typeof getMySession;
  revokeMySession: typeof revokeMySession;
  createSchema: typeof createSchema;
  getSchemaById: typeof getSchemaById;
  createFlowDefinition: typeof createFlowDefinition;
  listFlowDefinitions: typeof listFlowDefinitions;
  getFlowDefinition: typeof getFlowDefinition;
  updateFlowDefinition: typeof updateFlowDefinition;
  deleteFlowDefinition: typeof deleteFlowDefinition;
}

/**
 * Creates a typed API client with the base URL pre-bound.
 *
 * Each method sets the module-level `apiBaseUrl` before delegating to
 * the orval-generated function. This is safe because fetch calls are
 * not concurrent within a single JS turn — the URL is set synchronously
 * before the async fetch begins.
 */
export function createApi(apiBase: string): ZitadelApi {
  /**
   * Wrap a generated function so that `setApiBaseUrl` runs before every
   * call. TypeScript infers the exact parameter and return types from
   * the original function.
   */
  function bind<F extends (...args: never[]) => unknown>(fn: F): F {
    return ((...args: Parameters<F>) => {
      setApiBaseUrl(apiBase);
      return fn(...args);
    }) as F;
  }

  return {
    getOpenIDConfiguration: bind(getOpenIDConfiguration),
    authorizeGet: bind(authorizeGet),
    authorizeDevice: bind(authorizeDevice),
    endSession: bind(endSession),
    getEndSessionUrl: bind(getEndSessionUrl),
    introspect: bind(introspect),
    getKeys: bind(getKeys),
    revokeToken: bind(revokeToken),
    getToken: bind(getToken),
    getUserInfo: bind(getUserInfo),
    getHealth: bind(getHealth),
    getLive: bind(getLive),
    getReady: bind(getReady),
    listUsers: bind(listUsers),
    createFlow: bind(createFlow),
    getFlowStep: bind(getFlowStep),
    submitFlowStep: bind(submitFlowStep),
    submitFlowEvent: bind(submitFlowEvent),
    createAuthAttempt: bind(createAuthAttempt),
    getAuthAttempt: bind(getAuthAttempt),
    issueChallenge: bind(issueChallenge),
    verifyChallengeProof: bind(verifyChallengeProof),
    createHandoff: bind(createHandoff),
    createProject: bind(createProject),
    getProject: bind(getProject),
    createSession: bind(createSession),
    listSessions: bind(listSessions),
    exchangeHandoff: bind(exchangeHandoff),
    getSession: bind(getSession),
    revokeSession: bind(revokeSession),
    getMySession: bind(getMySession),
    revokeMySession: bind(revokeMySession),
    createSchema: bind(createSchema),
    getSchemaById: bind(getSchemaById),
    createFlowDefinition: bind(createFlowDefinition),
    listFlowDefinitions: bind(listFlowDefinitions),
    getFlowDefinition: bind(getFlowDefinition),
    updateFlowDefinition: bind(updateFlowDefinition),
    deleteFlowDefinition: bind(deleteFlowDefinition),
  };
}
