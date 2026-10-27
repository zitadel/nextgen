// Package designtokens embeds the generated `--zl-*` stylesheet for the Go
// server, which paints the error pages it renders itself with the tokens the
// console and the login surface use (ADR 076). The stylesheet is generated:
// change its source and run `moon run design-tokens:generate`.
package designtokens

import _ "embed"

// TokensCSS is src/generated/tokens.css: the dark theme on `:root`, the light
// one under `:root[data-theme="light"]`.
//
//go:embed src/generated/tokens.css
var TokensCSS string
