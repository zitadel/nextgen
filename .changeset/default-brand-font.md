---
"@zitadel/components": minor
---

Load the design-system brand font (Arimo) by default in `<zitadel-login>` so the
auth UI paints the brand face even when the server returns no branding; headings
render in bold Arimo. Tenant `branding.font_url` still overrides it. Exposes
`applyDefaultFont` and `DEFAULT_BRAND_FONT_HREF` so deployments can self-host the
default face.
