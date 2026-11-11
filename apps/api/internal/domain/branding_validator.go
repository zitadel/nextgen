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
	if err := validateBrandingFontURL(b.Typography); err != nil {
		return err
	}
	for _, u := range []struct{ name, value string }{
		{"logo_url", b.LogoURL},
		{"hero_url", b.HeroURL},
		{"theme.light.logo_url", brandingSideLogoURL(b.Theme.Light)},
		{"theme.dark.logo_url", brandingSideLogoURL(b.Theme.Dark)},
	} {
		if err := validateBrandingAssetURL(u.name, u.value); err != nil {
			return err
		}
	}
	if err := validateBrandingTheme(b.Theme); err != nil {
		return err
	}
	if err := validateBrandingTypography(b.Typography); err != nil {
		return err
	}
	return validateBrandingShape(b.Shape)
}

func brandingSideLogoURL(side *BrandingThemeSide) string {
	if side == nil {
		return ""
	}
	return side.LogoURL
}

func validateBrandingTheme(theme BrandingTheme) error {
	if theme.Mode != "" && !theme.Mode.IsValid() {
		return ErrBrandingInvalid(fmt.Sprintf("unknown theme.mode %q", theme.Mode), nil)
	}
	for _, side := range []struct {
		name string
		side *BrandingThemeSide
	}{
		{"theme.light", theme.Light},
		{"theme.dark", theme.Dark},
	} {
		if side.side == nil || side.side.Palette == nil {
			continue
		}
		if err := validateBrandingPalette(side.name, side.side.Palette); err != nil {
			return err
		}
	}
	return nil
}

// validateBrandingPalette holds every colour to the allowlist in
// branding_css.go. The widget writes these straight into a CSS declaration, so
// a value that can close that declaration can emit rules of its own.
func validateBrandingPalette(side string, palette *BrandingPalette) error {
	for _, colour := range []struct{ name, value string }{
		{"primary", palette.Primary},
		{"on_primary", palette.OnPrimary},
		{"background", palette.Background},
		{"surface", palette.Surface},
		{"muted", palette.Muted},
		{"border", palette.Border},
		{"text", palette.Text},
		{"text_muted", palette.TextMuted},
		{"link", palette.Link},
		{"success", palette.Success},
		{"warning", palette.Warning},
		{"error", palette.Error},
	} {
		if colour.value == "" {
			continue
		}
		if err := ValidateBrandingColor(side+".palette."+colour.name, colour.value); err != nil {
			return err
		}
	}
	return nil
}

func validateBrandingTypography(typography BrandingTypography) error {
	if typography.FontFamily != "" {
		if err := ValidateBrandingFontFamily(typography.FontFamily); err != nil {
			return err
		}
	}
	if typography.Scale != 0 && (typography.Scale < MinBrandingScale || typography.Scale > MaxBrandingScale) {
		return ErrBrandingInvalid(
			fmt.Sprintf("typography.scale must be between %g and %g", MinBrandingScale, MaxBrandingScale), nil)
	}
	return nil
}

func validateBrandingShape(shape BrandingShape) error {
	switch {
	case shape.Radius.Pixels != nil:
		if *shape.Radius.Pixels < 0 || *shape.Radius.Pixels > MaxBrandingRadiusPixels {
			return ErrBrandingInvalid(
				fmt.Sprintf("shape.radius must be between 0 and %d pixels; send %q for a pill",
					MaxBrandingRadiusPixels, BrandingRadiusFull), nil)
		}
	case shape.Radius.Preset != "":
		if !shape.Radius.Preset.IsValid() {
			return ErrBrandingInvalid(fmt.Sprintf("unknown shape.radius %q", shape.Radius.Preset), nil)
		}
	}
	if shape.Density != "" && !shape.Density.IsValid() {
		return ErrBrandingInvalid(fmt.Sprintf("unknown shape.density %q", shape.Density), nil)
	}
	if shape.LogoScale != 0 && (shape.LogoScale < MinBrandingLogoScale || shape.LogoScale > MaxBrandingLogoScale) {
		return ErrBrandingInvalid(
			fmt.Sprintf("shape.logo_scale must be between %g and %g", MinBrandingLogoScale, MaxBrandingLogoScale), nil)
	}
	return nil
}

// validateBrandingFontURL gates the tenant font stylesheet. Unlike logo and
// hero assets there is no loopback carve-out: a stylesheet is executable
// styling rather than an image, so it stays https everywhere.
//
// A URL without a family names nothing to paint with, and the pair is what a
// surface needs to render the face at all — so the two are validated together
// rather than each on its own.
func validateBrandingFontURL(typography BrandingTypography) error {
	if typography.FontURL == "" {
		return nil
	}
	if typography.FontFamily == "" {
		return ErrBrandingInvalid("typography.font_url needs a typography.font_family to load; a stylesheet alone names no face to render in", nil)
	}
	if len(typography.FontURL) > MaxBrandingURLBytes {
		return ErrBrandingInvalid(
			fmt.Sprintf("typography.font_url exceeds %d bytes", MaxBrandingURLBytes), nil)
	}
	u, err := url.Parse(typography.FontURL)
	if err != nil {
		return ErrBrandingInvalid("typography.font_url is not a valid URL", err)
	}
	if u.User != nil {
		return ErrBrandingInvalid(
			"typography.font_url must not carry credentials; the URL is fetched by every visitor's browser", nil)
	}
	if !strings.EqualFold(u.Scheme, "https") || u.Host == "" {
		return ErrBrandingInvalid("typography.font_url must be an absolute https URL", nil)
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
	if len(value) > MaxBrandingURLBytes {
		return ErrBrandingInvalid(
			fmt.Sprintf("%s exceeds %d bytes", name, MaxBrandingURLBytes), nil)
	}
	u, err := url.Parse(value)
	if err != nil {
		return ErrBrandingInvalid(fmt.Sprintf("%s is not a valid URL", name), err)
	}
	if u.User != nil {
		return ErrBrandingInvalid(
			fmt.Sprintf("%s must not carry credentials; the URL is fetched by every visitor's browser", name), nil)
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
