---
"@zitadel/server": minor
---

The server's API request metrics (`ogen.server.request_count`, `ogen.server.errors_count`, `ogen.server.duration`) now carry only the operation, method, route template and status code, so a request path with an id in it can no longer become a time series of its own. The configuration guide gains a Metrics section that lists every instrument the server reports through `instrumentation.metric`, with its attributes and their values, and documents the bound every instrument already had: at most 2000 series, past which new attribute combinations are counted on one series marked `otel.metric.overflow=true`. That bound is now covered by a test.
