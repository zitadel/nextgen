export { proxy } from "./zitadel";

export const config = {
  matcher: ["/__nextgen/:path*", "/admin", "/admin/:path*", "/login"],
};
