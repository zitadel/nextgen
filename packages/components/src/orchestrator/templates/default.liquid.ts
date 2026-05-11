/**
 * Bundled `default.liquid` master template.
 *
 * Branches on `branding.layout` (`centered` | `split`) per
 * `docs/design/branding/templates.md` "Built-in set". The `auth_form`
 * partial holds the actual atom emission so both layouts share the same
 * field/action plumbing.
 */
export const defaultTemplate = String.raw`
{% if branding.layout == 'split' %}
  <div class="zl-layout zl-layout--split">
    <aside class="zl-layout-hero" {% if branding.hero_url %}style="background-image: url('{{ branding.hero_url }}');"{% endif %}>
      {% if branding.logo_url %}
        <img class="zl-layout-hero-logo" src="{{ branding.logo_url }}" alt="" />
      {% endif %}
    </aside>
    <main class="zl-layout-body">
      {% include 'auth_form' %}
    </main>
  </div>
{% else %}
  <div class="zl-layout zl-layout--centered">
    {% include 'auth_form' %}
  </div>
{% endif %}

<style></style>
`;

/**
 * Layout chrome that lives outside the atoms but is owned by the package.
 * Applied as an `adoptedStyleSheet` alongside the branding tokens so the
 * `centered` and `split` layouts get their structural styling without each
 * tenant having to redefine it.
 */
export const layoutChromeCss = `
.zl-layout {
  display: flex;
  width: 100%;
  min-height: 100%;
  font-family: var(--zl-font-family, 'Inter', system-ui, sans-serif);
  background: var(--zl-color-background, #FFFFFF);
  color: var(--zl-color-text, #0F172A);
}
.zl-layout--centered {
  align-items: center;
  justify-content: center;
  padding: var(--zl-space-7, 2rem);
  min-height: 100vh;
}
.zl-layout--split {
  align-items: stretch;
  min-height: 100vh;
}
.zl-layout--split .zl-layout-hero {
  flex: 1 1 0;
  display: none;
  background-color: var(--zl-color-muted, #F1F4F9);
  background-size: cover;
  background-position: center;
  position: relative;
}
.zl-layout--split .zl-layout-hero-logo {
  position: absolute;
  top: var(--zl-space-7, 2rem);
  left: var(--zl-space-7, 2rem);
  width: 96px;
  height: auto;
}
.zl-layout--split .zl-layout-body {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--zl-space-7, 2rem);
}
@media (min-width: 768px) {
  .zl-layout--split .zl-layout-hero {
    display: block;
  }
}
.zl-shell {
  width: 100%;
  max-width: 28rem;
  margin: 0 auto;
}
.zl-card {
  display: flex;
  flex-direction: column;
  gap: var(--zl-space-5, 1.25rem);
  background: var(--zl-color-surface, #FFFFFF);
  border: var(--zl-border-width, 1px) solid var(--zl-color-border, #D8DEE6);
  border-radius: var(--zl-radius-lg, 0.75rem);
  box-shadow: var(--zl-shadow-md, 0 4px 16px rgba(15, 23, 42, 0.08));
  padding: var(--zl-space-7, 2rem);
}
.zl-logo {
  width: 96px;
  height: auto;
}
.zl-heading {
  margin: 0;
  font-size: var(--zl-font-size-xl, 1.5rem);
  font-weight: var(--zl-font-weight-bold, 600);
  line-height: var(--zl-line-height-tight, 1.2);
  color: var(--zl-color-text, #0F172A);
}
.zl-description {
  margin: 0;
  font-size: var(--zl-font-size-sm, 0.875rem);
  color: var(--zl-color-text-muted, #64748B);
  line-height: var(--zl-line-height-normal, 1.5);
}
`;
