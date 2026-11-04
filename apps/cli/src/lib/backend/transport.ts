/**
 * The few transport facts a caller that sends its own request needs: where the
 * API lives under a server, the header its CSRF token travels in, the request
 * function that honours a signal and a deadline, and the paging reader. Every
 * other call goes through a service.
 */
export { API_PREFIX, apiBaseUrl } from "@zitadel/api/runtime/base-url";
export { CSRF_HEADER, request } from "@zitadel/api/runtime/fetch";
export { Paging } from "@zitadel/api/runtime/paging";
