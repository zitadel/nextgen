---
title: Deploy a release to all your primary origins at once
summary: "Every deployment now has a kind, primary or preview, and a status, and one deploy with targets: [\"primary\"] makes a release live on all of a project's primary origins."
date: 2026-10-21T14:24Z
cloud: true
pulls: [1736, 1883, 1884]
---

Every deployment now carries a `kind`, `primary` or `preview`, and a `status`, `live` or `inactive`. A project's primary origins are deployed as a whole: `POST /deployments` with `targets: ["primary"]` makes a release live on all of them, so they always serve the same deployment, and a rollback re-deploys to every primary origin the project has.

- Deploying the release that is already live answers `200` and writes nothing.
- `expected_deployment_id` guards against racing another deploy, which answers `409` with `dep.conflict`.
- `GET /deployments` lists the deployments newest first: `origin` narrows the list to one origin, `live=true` lists what is served now, and `expand=release` embeds the release each one made live. `GET /deployments/{deployment_id}` reads one.

**Breaking:** a deploy that names a primary origin answers `400` with `dep.invalid`; deploy to `primary` instead.

[Deployments in the API reference](https://preview.zitadel.com/docs/reference/api/deployments)
