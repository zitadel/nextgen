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
