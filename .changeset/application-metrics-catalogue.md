---
"@zitadel/server": patch
---

The server's API request metrics (`ogen.server.request_count`, `ogen.server.errors_count`, `ogen.server.duration`) now carry only the operation, method, route template and status code, so a request path with an id in it can no longer become a time series of its own. Every metric the server reports through `instrumentation.metric` is now capped at 2000 series per instrument; past that, new attribute combinations are counted on one series marked `otel.metric.overflow=true`. The configuration guide's new Metrics section lists every instrument, with its attributes and their values.
