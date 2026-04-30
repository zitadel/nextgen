export { NextgenLogout } from './logout';

import { LitElement, css, html } from 'lit';

type FlowState =
  | { name: 'idle' }
  | { name: 'loading' }
  | { name: 'login'; csrf_token: string }
  | { name: 'success'; message: string }
  | { name: 'error'; message: string };

class NextgenLogin extends LitElement {
  static override properties = {
    proxyBase: { type: String, attribute: 'proxy-base' },
    postSignInUrl: { type: String, attribute: 'post-sign-in-url' },
    _flow: { state: true },
    _email: { state: true },
    _password: { state: true },
  };

  static override styles = css`
    :host {
      display: block;
      font-family:
        -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .card {
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
      max-width: 400px;
      margin: 0 auto;
      padding: 40px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 32px;
    }

    .logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 16px;
    }

    .logo-name {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
    }

    h2 {
      font-size: 22px;
      font-weight: 700;
      color: #111827;
      margin: 0 0 6px 0;
    }

    .subtitle {
      font-size: 14px;
      color: #6b7280;
      margin: 0 0 28px 0;
    }

    .field {
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 6px;
    }

    input {
      width: 100%;
      padding: 10px 12px;
      border: 1.5px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      color: #111827;
      background: #f9fafb;
      box-sizing: border-box;
      outline: none;
      transition:
        border-color 0.15s,
        background 0.15s;
    }

    input:focus {
      border-color: #6366f1;
      background: #ffffff;
    }

    button[type='submit'] {
      width: 100%;
      padding: 11px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 8px;
      transition: opacity 0.15s;
    }

    button[type='submit']:hover:not(:disabled) {
      opacity: 0.9;
    }

    button[type='submit']:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 20px 0;
    }

    .divider-line {
      flex: 1;
      height: 1px;
      background: #e5e7eb;
    }

    .divider-text {
      font-size: 12px;
      color: #9ca3af;
    }

    .sso-button {
      width: 100%;
      padding: 10px;
      background: white;
      border: 1.5px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      color: #374151;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.15s;
    }

    .sso-button:hover {
      background: #f9fafb;
    }

    .message {
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 13px;
      margin-bottom: 16px;
    }

    .message.error {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    .message.success {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid #e5e7eb;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin: 0 auto 12px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 12px;
      color: #9ca3af;
    }

    .footer a {
      color: #6366f1;
      text-decoration: none;
    }
  `;

  declare proxyBase: string;
  declare postSignInUrl: string;
  declare _flow: FlowState;
  declare _email: string;
  declare _password: string;

  constructor() {
    super();
    this.proxyBase = '/__nextgen';
    this.postSignInUrl = '';
    this._flow = { name: 'idle' };
    this._email = '';
    this._password = '';
  }

  override connectedCallback() {
    super.connectedCallback();
    this._startFlow();
  }

  private async _startFlow() {
    this._flow = { name: 'loading' };
    try {
      const res = await fetch(`${this.proxyBase}/v1/flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'init' }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._flow = { name: 'login', csrf_token: data.csrf_token ?? '' };
    } catch {
      this._flow = { name: 'login', csrf_token: '' };
    }
  }

  private async _handleSubmit(e: Event) {
    e.preventDefault();
    if (this._flow.name !== 'login') return;

    const csrf = this._flow.csrf_token;
    this._flow = { name: 'loading' };

    try {
      const res = await fetch(`${this.proxyBase}/v1/flow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          action: 'submit',
          email: this._email,
          password: this._password,
        }),
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ message: 'Sign in failed' }));
        this._flow = {
          name: 'error',
          message: err.message ?? 'Sign in failed',
        };
        return;
      }

      const data = await res.json();
      if (data.name === 'success' || data.status === 'complete') {
        this._flow = {
          name: 'success',
          message: data.message ?? 'You are signed in.',
        };
        this.dispatchEvent(
          new CustomEvent('nextgen-signin', {
            bubbles: true,
            composed: true,
            detail: data,
          }),
        );
        if (this.postSignInUrl) {
          window.location.href = this.postSignInUrl;
        }
      } else {
        this._flow = { name: 'login', csrf_token: data.csrf_token ?? '' };
      }
    } catch {
      this._flow = {
        name: 'error',
        message: 'Network error. Please try again.',
      };
    }
  }

  private _handleSso() {
    this.dispatchEvent(
      new CustomEvent('nextgen-sso', { bubbles: true, composed: true }),
    );
  }

  private _renderBody() {
    if (this._flow.name === 'loading') {
      return html`
        <div
          style="text-align:center;padding:32px 0;color:#6b7280;font-size:14px"
        >
          <div class="spinner"></div>
          Loading…
        </div>
      `;
    }

    if (this._flow.name === 'success') {
      return html`<div class="message success">${this._flow.message}</div>`;
    }

    return html`
      ${this._flow.name === 'error'
        ? html`<div class="message error">${this._flow.message}</div>`
        : ''}

      <form @submit=${this._handleSubmit}>
        <div class="field">
          <label for="email">Email address</label>
          <input
            id="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            .value=${this._email}
            @input=${(e: InputEvent) => {
              this._email = (e.target as HTMLInputElement).value;
            }}
            required
          />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            .value=${this._password}
            @input=${(e: InputEvent) => {
              this._password = (e.target as HTMLInputElement).value;
            }}
            required
          />
        </div>
        <button type="submit">Sign in</button>
      </form>

      <div class="divider">
        <div class="divider-line"></div>
        <span class="divider-text">or continue with</span>
        <div class="divider-line"></div>
      </div>

      <button class="sso-button" type="button" @click=${this._handleSso}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        Single sign-on (SSO)
      </button>
    `;
  }

  override render() {
    return html`
      <div class="card">
        <div class="logo">
          <div class="logo-icon">N</div>
          <span class="logo-name">Nextgen</span>
        </div>
        <h2>Welcome back</h2>
        <p class="subtitle">Sign in to your account to continue</p>
        ${this._renderBody()}
        <div class="footer">Protected by <a href="#">Nextgen Auth</a></div>
      </div>
    `;
  }
}

customElements.define('nextgen-login', NextgenLogin);

export { NextgenLogin };

declare global {
  interface HTMLElementTagNameMap {
    'nextgen-login': NextgenLogin;
  }
}
