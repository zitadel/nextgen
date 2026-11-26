---
title: See a login flow as a canvas in the console
summary: A login flow's screen in the console draws each step as a card in your project's branding, with a named arrow for each transition, and zooms, pans and opens full screen.
date: 2026-11-24T11:23Z
cloud: true
pulls: [3257, 3292]
---

A login flow's screen in the console now has a **Canvas**: a card per step sketching its fields, its actions and its sign-in provider buttons, and an arrow per transition, named by what fires it. The cards paint in your project's newest branding, its colours, radius, font and logo, on the console's light or dark side. They sketch each screen; they are not the login itself, and the canvas only shows the flow, which you still change in your flow files.

- Zoom with Ctrl or ⌘ and the wheel, a pinch or the keyboard, drag to pan, and press **Fit** to see the whole flow. The canvas opens already fitted.
- Hover over or focus a step to isolate the transitions into and out of it.
- Open it full screen, and close that with Esc.
- `@zitadel/components` exports `brandingDeclarations(branding, side)`, the `--zl-*` values a branding revision paints for one side, for a host that sets them on an element rather than adopting the stylesheet.

[Edit the login flow](https://preview.zitadel.com/docs/guides/edit-login-flow)
