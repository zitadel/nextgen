---
"@zitadel/components": minor
"@zitadel/server": minor
---

The console's branding preview runs in the selected project and shows the login in a chosen state.

The preview now starts the flow of the project selected in the switcher rather than the console's own, so on a platform deployment it renders a customer project's flow beside that project's branding. A state selector beside the screen tabs shows the step as a visitor first sees it, with validation errors, with a submission error, loading, or on the success screen.

`<zitadel-login>` gains `preview-state` for this. Set, the element starts the flow as usual, shows the served step in that state, and submits nothing. `preview-success-step` names the terminal step the success state paints, for a flow that does not end on the default `done`. The terminal screen's heading is centred in its card.
