---
"@zitadel/server": minor
---

The opt-in service ping also reports to Mixpanel, through the Zitadel cloud (`preview.zitadel.com`), with the same properties it sends Vercel Web Analytics. Mixpanel is told not to locate the server by its IP address, and the ping carries no id for the installation. `service_ping.mixpanel_endpoint` and `service_ping.mixpanel_token` point it elsewhere, as `service_ping.vercel_endpoint` does for Vercel.
