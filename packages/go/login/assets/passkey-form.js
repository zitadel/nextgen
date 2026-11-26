// The form glue for <zl-passkey> (passkey-standalone.mjs follows this file in
// the same module, so these listeners are in place before the atom runs):
// the atom runs the WebAuthn ceremony on its own and reports by event; the
// proof goes to the server as the form's challenge_response, under the
// ceremony's method as the action, the way <zitadel-login> submits it.
document.addEventListener("zl-passkey-result", (event) => {
  const form = event.target.closest("form");
  form.elements.challenge_response.value = JSON.stringify(event.detail);
  // A submit from script names no button, so the action is set here.
  const action = document.createElement("input");
  action.type = "hidden";
  action.name = "action";
  action.value = event.detail.method;
  form.append(action);
  form.requestSubmit();
});

// A ceremony the user closed, that timed out or that failed: say so, and
// leave the passkey button to start another.
document.addEventListener("zl-passkey-error", (event) => {
  const { aborted, timed_out: timedOut } = event.detail;
  const error = event.target.closest("form").querySelector(".passkey-error");
  error.textContent = error.dataset[timedOut ? "timeout" : aborted ? "cancelled" : "failed"];
  error.hidden = false;
});
