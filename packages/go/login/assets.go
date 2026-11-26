package login

import _ "embed"

// tokensCSS is a generated copy of the design tokens' stylesheet, by
// scripts/generate-go-login-assets.ts, so this module needs no other
// package of the repository.
//
//go:embed assets/tokens.css
var tokensCSS string

// loginCSS is the login's own rules over the tokens.
//
//go:embed assets/login.css
var loginCSS string

// passkeyFormJS is the login's own glue between <zl-passkey> and its form.
//
//go:embed assets/passkey-form.js
var passkeyFormJS string

// passkeyStandaloneJS is a generated copy of the components package's
// self-contained build of <zl-passkey>, by the same script as tokensCSS.
//
//go:embed assets/passkey-standalone.mjs
var passkeyStandaloneJS string
