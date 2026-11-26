---
title: zitadel setup finishes when you press Enter at every question
summary: Continuing without SSO is now preselected, so pressing Enter no longer sends setup back to the provider list again and again. The sign-in, register and profile pages setup scaffolds centre the Zitadel widget.
date: 2026-11-25T01:40Z
pulls: [3301, 3319]
---

In `zitadel setup`, picking no external sign-in provider asks "Would you like to continue without setting up SSO?". Yes is now preselected. No was before, and No goes back to the provider list, so pressing Enter at every question went round that list and setup never finished. No still goes back to the list.

The sign-in, register and profile pages that `zitadel setup` scaffolds for Angular, Qwik, Qwik Router, React, Solid, Solid Start, Svelte, SvelteKit, TanStack Start and Vue now centre the Zitadel widget in the window. Before, the card sat against the top edge of the page.

[Quickstart](https://preview.zitadel.com/docs/get-started/quickstart)
