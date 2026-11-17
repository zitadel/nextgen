---
title: A release alone decides which login flows are live
summary: Flow definitions no longer take a status, and every flow a release pins is served. Delete the status line from your .zitadel/flows/ files before your next deploy.
date: 2026-11-12T18:32Z
cloud: true
pulls: [2943]
---

A flow definition no longer has a `status`. Every flow that a release pins is served, so the release you deploy is the one place that decides which login flows are live.

**Breaking:** a flow definition that still sends `status` is refused. Delete the `"status"` line from each file in `.zitadel/flows/` before your next `zitadel deploy`. A `draft` flow is served as soon as a release pins it, including a release deployed before the upgrade: if a draft should stay off, move it out of `.zitadel/flows/` and deploy before you upgrade a self-hosted server.

[Edit the login flow](https://preview.zitadel.com/docs/guides/edit-login-flow)
