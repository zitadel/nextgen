---
title: Invite colleagues to a project from the console
summary: A project's settings now have a Members page, where you invite a colleague with a link and replace or cancel the invitations you sent. Whoever opens the link joins the project or declines. Add admin is gone.
date: 2026-11-24T08:34Z
cloud: true
pulls: [2978, 3066]
---

Give a colleague access to a project from Project Settings → **Members**, beside General. **Invite member** asks for an optional name and a role, `viewer`, `editor` or `admin`, and shows the link once, inside a message ready to copy. The name is a reminder for other admins and is not matched to an account. The link expires in 72 hours.

Whoever opens the link sees who invited them, the role and when the link expires, then chooses **Join project** or **Decline invitation**. Someone who is not signed in signs in or signs up first and comes back to the invitation.

- The **Members** tab lists who has access to the project and removes it.
- The **Invitations** tab lists the pending, expired and declined invitations, newest first, with who sent each one. An accepted invitation leaves the list, because that person is now on the Members tab.
- A pending invitation offers **Regenerate link** and **Cancel invitation**, an expired one **Regenerate link** and **Remove invitation**, and a declined one **Remove invitation**. Each asks first. A declined invitation keeps its name and shows the day it was declined.

The Members page no longer has **Add admin**. Invite a colleague with a link instead, or grant a role to a user or team you already know with `zitadel grant create`. Invitations need a claimed project and a server with a platform project. The cloud and `zitadel start` have one; on a self-hosted server without it, give access with the CLI or `POST /grants`.

[Manage project access](https://preview.zitadel.com/docs/guides/manage-project-access), [Access and memberships](https://preview.zitadel.com/docs/concepts/access-and-memberships)
