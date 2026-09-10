---
"@zitadel/server": patch
---

Fetching a schema from a URL (`POST /schemas` with `kind: schema-url`) is now
guarded against server-side request forgery and resource exhaustion. By
default the server refuses to fetch from localhost, private networks, and
cloud metadata addresses (checked on the resolved IP at connect time, so DNS
tricks and redirects cannot bypass it), caps responses at 1 MiB, follows at
most 5 redirects, refuses https-to-http downgrades, and bounds each request
to 10s with 30s for a whole schema including its `$ref` chain. Rejections
return distinct errors naming the failing URL. Tune or relax this under the
new `httpclient` config block; for local development against a loopback
schema host, set `httpclient.allow_list: [localhost, 127.0.0.0/8]`.
