/**
 * Atom playground. Renders each shipped `<zl-*>` atom in isolation against a
 * controlled background so we can verify states (default, loading, ghost,
 * error, dark) without booting the full orchestrator.
 */

const tokenScopes = {
  light: `
    --zl-color-primary: #4A90D9;
    --zl-color-on-primary: #FFFFFF;
    --zl-color-background: #F8FAFC;
    --zl-color-surface: #FFFFFF;
    --zl-color-text: #0F172A;
    --zl-color-text-muted: #64748B;
    --zl-color-border: #E2E8F0;
    --zl-color-muted: #F1F5F9;
    --zl-color-link: #2563EB;
    --zl-color-error: #DC2626;
    --zl-color-focus-ring: rgba(74, 144, 217, 0.45);
    --zl-font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
  `,
  dark: `
    --zl-color-primary: #7C9CFF;
    --zl-color-on-primary: #0A0A0A;
    --zl-color-background: #0A0A0A;
    --zl-color-surface: #111111;
    --zl-color-text: #FAFAFA;
    --zl-color-text-muted: #A1A1AA;
    --zl-color-border: #262626;
    --zl-color-muted: #1A1A1A;
    --zl-color-link: #9DBBFF;
    --zl-color-error: #F87171;
    --zl-color-focus-ring: rgba(124, 156, 255, 0.45);
    --zl-font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
  `,
};

export function renderAtomPlayground(host: HTMLElement): void {
  host.innerHTML = `
    <style>
      .grid {
        flex: 1 1 auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
        gap: 24px;
        padding: 24px;
        align-content: start;
      }
      .card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--surface);
      }
      .card h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .scope {
        padding: 16px;
        border-radius: 8px;
        background: var(--zl-color-background, #fff);
        color: var(--zl-color-text, #0f172a);
      }
      .scope-light { ${tokenScopes.light} }
      .scope-dark { ${tokenScopes.dark} }
      .row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: center;
      }
    </style>
    <div class="grid">
      <section class="card">
        <h3>zl-field — light</h3>
        <div class="scope scope-light">
          <zl-field
            name="email"
            label="Email address"
            type="email"
            placeholder="you@example.com"
            autocomplete="username"
            required
          ></zl-field>
        </div>
      </section>

      <section class="card">
        <h3>zl-field — invalid + error</h3>
        <div class="scope scope-light">
          <zl-field
            name="email"
            label="Email address"
            type="email"
            value="not-an-email"
            invalid
            error="Enter a valid email address."
          ></zl-field>
        </div>
      </section>

      <section class="card">
        <h3>zl-field — dark</h3>
        <div class="scope scope-dark">
          <zl-field
            name="password"
            label="Password"
            type="password"
            autocomplete="current-password"
            required
          ></zl-field>
        </div>
      </section>

      <section class="card">
        <h3>zl-submit</h3>
        <div class="scope scope-light">
          <div class="row">
            <zl-submit action="submit" label="Continue"></zl-submit>
          </div>
          <div class="row" style="margin-top:12px">
            <zl-submit action="submit" label="Continue" loading></zl-submit>
          </div>
        </div>
      </section>

      <section class="card">
        <h3>zl-action</h3>
        <div class="scope scope-light">
          <div class="row">
            <zl-action action="register" label="Create account"></zl-action>
            <zl-action ghost action="forgot" label="Forgot password?"></zl-action>
          </div>
        </div>
      </section>

      <section class="card">
        <h3>zl-error</h3>
        <div class="scope scope-light">
          <zl-error message="Those credentials don't match. Try again."></zl-error>
        </div>
      </section>
    </div>
  `;
}
