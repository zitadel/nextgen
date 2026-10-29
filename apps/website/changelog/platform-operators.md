---
title: Name the people who run your deployment as platform operators
summary: A self-hosted deployment can name platform operators, who administer every project and whose changes are marked as theirs in each project's events.
date: 2026-10-23T18:50Z
cloud: true
pulls: [2246]
---

Set `platform.operators` (`NEXTGEN_PLATFORM_OPERATORS`) to the user ids, in the platform project, of the people who run a deployment. An operator administers every project of the deployment, and their project list in the console is every project. Every change an operator makes is marked as such in the changed project's events. The hosted cloud makes its root admin an operator.

A change a console session makes in another project is now recorded in that project's events, not in the events of the project the session belongs to.
