---
"@zitadel/components": minor
---

A visitor who is already signed in and opens a page with `<zitadel-login post-sign-in-url="…">` now sees "Signed in as …" with **Continue** and **Sign out** instead of the sign-in form. Continue goes where a sign-in would have gone; Sign out ends the session and shows the form. Without `post-sign-in-url` the element behaves as before.
