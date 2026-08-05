---
"@zitadel/components": minor
---

The built-in locale dictionaries ship neutral email copy — "Email" / "you@example.com" (de: "du@beispiel.de", it: "E-mail" / "tu@esempio.com") — instead of the business-flavored "Work email" / "you@company.com". Products that want the previous work-email framing spread the new `businessLocales` overlay over the built-in dictionary via the `locales` property. The `it` dictionary is now also exported from the package root.
