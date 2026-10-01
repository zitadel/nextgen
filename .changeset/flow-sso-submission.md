---
---

Accept the submission a provider button makes. The engine previously refused every SSO submission outright (`ErrFlowUnsupported`), so a rendered provider button could not be pressed. It now checks the submitted slug against the step's own `sso_providers`, asks a `FlowSSOAuthorizer` to record the pending callback and build the authorize URL, and renders a step carrying only that redirect. The step is not advanced: a hand-off is a full-page navigation to another origin, and the flow resumes where it left off when the provider returns. The identity layer's implementation of the port is the next piece, so the server still wires no authorizer and a pressed button reports a flow integrity error until it does.
