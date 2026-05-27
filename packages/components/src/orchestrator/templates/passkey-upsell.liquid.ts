/**
 * `passkey-upsell` partial — third Figma target screen (file
 * `xkvBjkOJ8ENuHdTGZHXezK`, node `6594:630`).
 *
 * Differs from `auth-form`:
 *   - heading + subtitle live in a compact card (gap 24px instead of 32px),
 *   - primary "Set up passkey" CTA carries a trailing 24px passkey icon
 *     (Figma slots the icon to the right of the label, not above it),
 *   - secondary "Skip for now" uses the dark secondary hierarchy, not the
 *     `text` hierarchy — the Figma button has a solid #252528 background.
 *
 * Server-side errors land in a `<zl-alert>` the same way as the auth form.
 */
export const passkeyUpsellTemplate = String.raw`
<zl-page-shell data-zl-template-root>
  {% if branding.logo_url %}
    <img slot="header" class="zl-card-logo" src="{{ branding.logo_url }}" alt="" />
  {% endif %}
  <zl-card compact>
    <h1 slot="header" class="zl-card-title">{{ step.texts.title_key | t: identity.display_name }}</h1>
    <p slot="header" class="zl-card-subtitle">{{ 'passkey-upsell.description.line1' | t }}</p>
    <p slot="header" class="zl-card-subtitle">{{ 'passkey-upsell.description.line2' | t }}</p>

    {% if errors and errors.size > 0 %}
      {% for err in errors %}
        {% if err | formLevelError %}
          <zl-alert severity="error">
            {% if err.text_key %}{{ err.text_key | t }}{% else %}{{ err.message }}{% endif %}
          </zl-alert>
        {% endif %}
      {% endfor %}
    {% endif %}

    {% for entry in actions %}
      {% if entry[1].primary %}
        <zl-button
          slot="footer"
          hierarchy="primary"
          size="medium"
          type="submit"
          block
          action="{{ entry[0] }}"
          {% if loading %}loading disabled{% endif %}
        >
          {{ entry[1].text_key | t }}
          <zl-icon slot="trailing" name="passkey" size="24"></zl-icon>
        </zl-button>
      {% endif %}
    {% endfor %}

    {% for entry in actions %}
      {% unless entry[1].primary %}
        <zl-button
          slot="footer"
          hierarchy="secondary"
          size="medium"
          type="button"
          block
          action="{{ entry[0] }}"
          label="{{ entry[1].text_key | t }}"
        ></zl-button>
      {% endunless %}
    {% endfor %}

    {% required_atoms %}

    {% if challenge and challenge.method == "passkey" %}
      <zl-passkey
        ceremony="{{ challenge.options.ceremony | default: 'register' }}"
        challenge-id="{{ challenge.challenge_id }}"
        options='{{ challenge.options | json }}'
      ></zl-passkey>
    {% endif %}
  </zl-card>
</zl-page-shell>
`;
