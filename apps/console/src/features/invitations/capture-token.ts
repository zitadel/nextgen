import { captureInvitationToken } from "./token";

// A side-effect module, imported first by `main.tsx`: modules run in import
// order, so the invitation token leaves the address bar before the router, the
// build's add-on or any script they load can read the page's URL.
captureInvitationToken();

// A link opened in a tab that already shows the invitation page changes only
// the fragment, which loads no new document. The token is taken out of the
// address the same way, and the page starts over to look the new one up.
window.addEventListener("hashchange", () => {
  if (captureInvitationToken()) window.location.reload();
});
