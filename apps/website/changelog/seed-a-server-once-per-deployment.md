---
title: Seed a self-hosted server once per deployment
summary: The server's new seed command seeds the database once as you deploy, so every replica starts without writing to it. Password hashing has a budget per process, and every request is traced.
date: 2026-11-16T16:11Z
cloud: true
pulls: [3168, 2714, 3086]
---

The server has a `seed` command, and `server --seed=false` starts without seeding. Run `migrate` and `seed` once as you deploy, with the configuration and master key the servers use, and every replica starts without writing to the database:

```sh
nextgen migrate
nextgen seed --user-file admin.json
nextgen server --seed=false
```

`seed` creates the platform project, imports the `--user-file` users and reconciles `platform.operators`. Without the flag, a start seeds as before. Write the flag with `=`: `--seed false` is refused.

- Each server process limits how many passwords it hashes at once, so a burst of sign-ins no longer exhausts memory or stalls other requests. By default the budget follows the container's memory limit; tune it under `password_hasher.concurrency`. A request that finds no room within `max_wait` gets `429` with `Retry-After` and `user.password_hashing_busy`: safe to retry, and never a failed sign-in.
- Every request has one server span covering all of its middleware, `404` and `405` answers included. Each PostgreSQL query span names its verb in `db.operation.name`, and a `pgx.acquire` span appears only for a wait of a millisecond or more.

[Server configuration](https://github.com/zitadel/nextgen/blob/main/docs/quick-start/configuration.md#server)
