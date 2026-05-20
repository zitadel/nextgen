/**
 * `signed-in` partial — fourth Figma target screen (file
 * `xkvBjkOJ8ENuHdTGZHXezK`, node `6596:132844`).
 *
 * Figma layout:
 *   - heading "You're signed in as" (left-aligned, full width)
 *   - body line with the authenticated email address (Arimo Regular 16/24)
 *   - "Continue" primary CTA
 *   - "Logout" secondary CTA
 *
 * No avatar / identity hero glyph: the Figma frame is intentionally a
 * pure modal layover and dropping the avatar keeps the orchestrator
 * default in lockstep with the spec.
 *
 * Rendered when the flow returns a terminal step (`complete: "show"`)
 * and no `post-sign-in-url` is configured, so the user can confirm the
 * identity before the host SPA takes over.
 */
export const signedInTemplate = String.raw`
<zl-page-shell data-zl-template-root>
  {% if branding.logo_url %}
    <img slot="header" class="zl-card-logo" src="{{ branding.logo_url }}" alt="" />
  {% endif %}
  <zl-card compact>
    <h1 slot="header" class="zl-card-title">
      {{ step.texts.title_key | t: identity.display_name }}
    </h1>
    {% if identity.email_address or identity.display_name %}
      <p slot="header" class="zl-card-subtitle">
        {{ identity.email_address | default: identity.display_name }}
      </p>
    {% endif %}

    {% if errors and errors.size > 0 %}
      {% for err in errors %}
        <zl-alert severity="error">{{ err.text_key | t }}</zl-alert>
      {% endfor %}
    {% endif %}

    {% if actions and actions.size > 0 %}
      {% for entry in actions %}
        {% if entry[1].primary %}
          <zl-button
            slot="footer"
            hierarchy="primary"
            size="medium"
            type="submit"
            block
            action="{{ entry[0] }}"
            label="{{ entry[1].text_key | t }}"
            {% if loading %}loading{% endif %}
          ></zl-button>
        {% endif %}
      {% endfor %}

      {% for entry in actions %}
        {% unless entry[1].primary %}
          <zl-button
            slot="footer"
            hierarchy="secondary"
            size="medium"
            block
            action="{{ entry[0] }}"
            label="{{ entry[1].text_key | t }}"
          ></zl-button>
        {% endunless %}
      {% endfor %}
    {% else %}
      {% comment %}
        Fallback when the API ships a terminal step with no actions —
        matches Figma node 6596:132844 which always renders Continue
        + Logout. The orchestrator wires these to its built-in
        continue / logout handlers.
      {% endcomment %}
      <zl-button
        slot="footer"
        hierarchy="primary"
        size="medium"
        type="submit"
        block
        action="continue"
        label="{{ 'signed-in.continue' | t }}"
      ></zl-button>
      <zl-button
        slot="footer"
        hierarchy="secondary"
        size="medium"
        block
        action="logout"
        label="{{ 'signed-in.logout' | t }}"
      ></zl-button>
    {% endif %}

    {% mandatory_gates %}
  </zl-card>
</zl-page-shell>
`;
