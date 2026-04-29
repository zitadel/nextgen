import { defineEventHandler, getRequestURL } from "h3";

const { nextgenIssuerUrl } = useRuntimeConfig();

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const suffix = url.pathname.replace(/^\/__nextgen/, "");
  const target = `${nextgenIssuerUrl}${suffix}${url.search}`;

  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(event.node.req.headers)) {
    if (v && !HOP_BY_HOP.has(k.toLowerCase())) {
      reqHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
  }

  const method = event.node.req.method ?? "GET";
  const upstream = await fetch(target, {
    method,
    headers: reqHeaders,
    redirect: "manual",
  });

  event.node.res.statusCode = upstream.status;
  for (const [k, v] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) {
      event.node.res.setHeader(k, v);
    }
  }

  return upstream.body;
});
