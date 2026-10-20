---
"@zitadel/components": minor
"@zitadel/testing": minor
---

The login widget, the session and logout widgets and every atom now attach closed shadow roots in the published package, the npm entries and the standalone file alike, so a script on the page can no longer read a typed password through `document.querySelector("zitadel-login").shadowRoot`, through the nested `<zl-field>` root, through `renderRoot` or through `composedPath()` on an event raised inside. Source builds, which is what the component tests, Storybook and development servers run, keep the roots open through one constant, `SHADOW_ROOT_MODE`. This is a guard against casual reads and not an isolation boundary: it does not stop a script that runs before the widget loads, or the key presses the browser delivers to the page, and full isolation needs a cross-origin iframe. Consumers who pierce the widget's shadow roots in a production build, with Playwright or a DOM-walking agent, must open them first: `@zitadel/testing/playwright` now opens the roots of every page in its `test`, adds `widgetTest` for suites without an instance, and exports `openShadowRoots(page)` for pages created by hand.
