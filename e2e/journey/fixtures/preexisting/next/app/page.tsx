// The host app's own landing page: on a pre-existing app, setup must not
// replace it with the /login redirect a fresh scaffold gets (ADR 044).
export default function HomePage() {
  return (
    <main>
      <h1>Welcome to Orbit Notes</h1>
      <p>Your notes, in orbit.</p>
    </main>
  );
}
