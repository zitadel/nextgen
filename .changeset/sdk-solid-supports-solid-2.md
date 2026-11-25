---
"@zitadel/sdk-solid": minor
---

`@zitadel/sdk-solid` now works with Solid 2 as well as Solid 1, from the same import. The components ship as uncompiled JSX under the `solid` export condition, so an app's own Solid plugin compiles them for the Solid it installed, and the widget events no longer use the `on:` syntax Solid 2 dropped, which left `onSignout` and the flow callbacks silently unbound. Apps whose bundler doesn't set the `solid` condition keep getting the prebuilt Solid 1 build.
