/**
 * Bundled `auth_form` partial. Pulled in via `{% include 'auth_form' %}` from
 * `default.liquid`. Mirrors the canonical skeleton in
 * `docs/design/branding/templates.md` lines 52-100.
 */
export const authFormTemplate = String.raw`
<div class="zl-shell">
  <div class="zl-card">
    {% if branding.logo_url %}
      <img class="zl-logo" src="{{ branding.logo_url }}" alt="" />
    {% endif %}

    <h2 class="zl-heading">{{ step.texts.title_key | t: identity.display_name }}</h2>

    {% if step.texts.description_key %}
      <p class="zl-description">
        {{ step.texts.description_key | t: identity.display_name }}
      </p>
    {% endif %}

    {% if errors and errors.size > 0 %}
      {% for err in errors %}
        <zl-error message="{{ err.text_key | t }}"></zl-error>
      {% endfor %}
    {% else %}
      <zl-error></zl-error>
    {% endif %}

    {% for entry in fields %}
      <zl-field
        name="{{ entry[0] }}"
        label="{{ entry[1].text_key | t }}"
        type="{{ entry[1].type }}"
        value="{{ entry[1].value }}"
        autocomplete="{{ entry[1].autocomplete }}"
        {% if entry[1].required %}required{% endif %}
      ></zl-field>
    {% endfor %}

    {% for entry in actions %}
      {% if entry[1].primary %}
        <zl-submit
          action="{{ entry[0] }}"
          label="{{ entry[1].text_key | t }}"
          {% if loading %}loading{% endif %}
        ></zl-submit>
      {% endif %}
    {% endfor %}

    {% for entry in actions %}
      {% unless entry[1].primary %}
        <zl-action
          ghost
          action="{{ entry[0] }}"
          label="{{ entry[1].text_key | t }}"
        ></zl-action>
      {% endunless %}
    {% endfor %}

    {% mandatory_gates %}
  </div>
</div>
`;
