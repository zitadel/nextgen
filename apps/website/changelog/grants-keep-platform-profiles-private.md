---
title: A project secret can no longer read a platform user's profile
summary: The grants API no longer shows a granted platform user's profile to a project secret, and a project that has not been claimed can no longer grant platform users or teams.
date: 2026-11-04T16:34Z
cloud: true
pulls: [2679]
---

A security fix for the grants API. A project secret could read the profile of a platform user granted on its project, through the grants API's `expand=principal`. It no longer can, and a project that has not been claimed can no longer grant platform users or teams.

**Breaking:** `expand=principal` on `GET /grants/{id}` and `POST /grants/query` answers `403` `user.permission_denied` unless the caller can read the platform project. `POST /grants` on a project that has not been claimed answers `403` `grant.project_unclaimed`: claim the project first, with `zitadel claim`.
