package domain

import (
	"fmt"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// MaxBrandingTemplateBytes caps the stored template size. Matches the
// maxLength on branding.liquid_template in the OpenAPI contract (which ogen
// enforces in characters; this gate re-checks in bytes).
const MaxBrandingTemplateBytes = 131072 // 128 KiB

// The server-side template gate is deliberately lexical: the server is Go and
// the template dialect is LiquidJS, so a faithful AST validation here would
// validate the wrong language. The authoritative LiquidJS validation runs at
// authoring time (`zitadel plan`/`apply`, @zitadel/config); the render
// pipeline in @zitadel/components is safe against stored templates regardless
// (escaping, neutered `raw`, DOMPurify, CSP). See ADR 040 and
// docs/design/flowengine/template-security.md. The banned patterns below
// mirror BANNED_TEMPLATE_PATTERNS in packages/config/src/template.ts; keep the
// two lists in sync.
var (
	// <script … and <style … tags (scripts are inert under CSP, styles are
	// orchestrator-owned; both are stripped by DOMPurify at render).
	brandingScriptTag = regexp.MustCompile(`(?i)<\s*script\b`)
	brandingStyleTag  = regexp.MustCompile(`(?i)<\s*style\b`)
	// Inline event handlers, matched only inside an open tag so Liquid
	// variables like `{% assign online = … %}` don't false-positive. The
	// separator class includes `/` because HTML treats a slash between
	// attributes as whitespace (`<img/onerror=…>` parses as a handler).
	brandingInlineHandler = regexp.MustCompile(`(?i)<[a-z][^>]*[\s/]on[a-z]+\s*=`)
	// javascript: URLs in attribute values.
	brandingJavascriptURL = regexp.MustCompile(`(?i)javascript\s*:`)
	// The | raw Liquid filter (neutered at render, rejected here anyway).
	brandingRawFilter = regexp.MustCompile(`\|\s*raw\b`)
)

var brandingLayouts = map[string]struct{}{
	BrandingLayoutCentered: {},
	BrandingLayoutSplit:    {},
}

// ValidateBranding is the lexical save gate for branding revisions.
func ValidateBranding(b *Branding) error {
	if _, ok := brandingLayouts[b.Layout]; !ok {
		return ErrBrandingInvalid(fmt.Sprintf("unknown layout %q", b.Layout), nil)
	}
	if err := validateBrandingTemplate(b.LiquidTemplate); err != nil {
		return err
	}
	// font_url stays read-only in v1: the component must load the tenant font
	// stylesheet at document level (shadow-scoped @font-face rules never
	// register faces), so accepting an arbitrary URL here would hand
	// branding.write document-level CSS control over every page embedding the
	// login — bypassing the template sandbox. Safe delivery (FontFace API
	// against font binaries, or an allowlist) is a follow-up in ADR 040.
	if b.FontURL != "" {
		return ErrBrandingInvalid("font_url is not writable yet: tenant font delivery needs a safe design (ADR 040); load fonts from the embedding page instead", nil)
	}
	for _, u := range []struct{ name, value string }{
		{"logo_url", b.LogoURL},
		{"hero_url", b.HeroURL},
	} {
		if err := validateBrandingAssetURL(u.name, u.value); err != nil {
			return err
		}
	}
	return nil
}

func validateBrandingTemplate(template string) error {
	if template == "" {
		return nil
	}
	if len(template) > MaxBrandingTemplateBytes {
		return ErrBrandingInvalid(fmt.Sprintf("liquid_template exceeds %d bytes", MaxBrandingTemplateBytes), nil)
	}
	if !utf8.ValidString(template) {
		return ErrBrandingInvalid("liquid_template is not valid UTF-8", nil)
	}
	for _, banned := range []struct {
		pattern *regexp.Regexp
		reason  string
	}{
		{brandingScriptTag, "liquid_template must not contain <script> tags"},
		{brandingStyleTag, "liquid_template must not contain <style> tags (theming is orchestrator-owned)"},
		{brandingInlineHandler, "liquid_template must not contain inline event handlers (on*= attributes)"},
		{brandingJavascriptURL, "liquid_template must not contain javascript: URLs"},
		{brandingRawFilter, "liquid_template must not use the | raw filter"},
	} {
		if banned.pattern.MatchString(template) {
			return ErrBrandingInvalid(banned.reason, nil)
		}
	}
	return nil
}

// validateBrandingAssetURL requires https asset URLs so the login widget never
// mixes content on customer origins. Loopback HTTP (http://localhost /
// 127.0.0.0/8 / ::1) is the one carve-out: it is the CLI local-runtime dev
// posture, where the natural asset host is the app's own dev server. Unlike
// the request-origin cookie predicate, this stored URL contract accepts only
// canonical host spellings so the Go, TypeScript, and editor gates agree.
func validateBrandingAssetURL(name, value string) error {
	if value == "" {
		return nil
	}
	u, err := url.Parse(value)
	if err != nil {
		return ErrBrandingInvalid(fmt.Sprintf("%s is not a valid URL", name), err)
	}
	if strings.EqualFold(u.Scheme, "http") && isCanonicalLoopbackAssetURL(u) {
		return nil
	}
	if !strings.EqualFold(u.Scheme, "https") || u.Host == "" {
		return ErrBrandingInvalid(fmt.Sprintf("%s must be an absolute https URL (http is allowed for canonical loopback development hosts only)", name), nil)
	}
	return nil
}

// isCanonicalLoopbackAssetURL accepts localhost, canonical dotted-decimal
// 127.0.0.0/8, and the exact IPv6 spelling ::1. Userinfo and invalid/empty
// ports are rejected so the URL has the same meaning in Go and WHATWG parsers.
func isCanonicalLoopbackAssetURL(u *url.URL) bool {
	if u.Host == "" || u.User != nil || strings.HasSuffix(u.Host, ":") {
		return false
	}
	if port := u.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return false
		}
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if host == "::1" {
		return true
	}
	ip, err := netip.ParseAddr(host)
	return err == nil && ip.Is4() && ip.As4()[0] == 127
}
