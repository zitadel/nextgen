// zitadel-cli: managed-file v1
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { createNextgenMiddleware } from "@zitadel/sdk-tanstack-start/server";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const authMiddleware = createMiddleware({ type: "request" }).server(
  createNextgenMiddleware({
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  }),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, authMiddleware],
}));
