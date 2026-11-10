package domain

import (
	"fmt"
	"regexp"
	"strings"
)

// Appearance values reach the browser as CSS declarations: the widget's token
// bridge writes `--zl-primary: <value>;` into a stylesheet it adopts on the
// login shadow root. A value that can close its own declaration can therefore
// emit rules of its own, which is the same power the template gate already
// withholds from `branding.write` by banning `<style>`.
//
// The gates below are allowlists. A value is stored only when it matches a
// form recognised here — not merely when it avoids the characters someone
// thought to ban. That ordering matters: CSS keeps growing colour syntax, and
// a denylist silently widens every time it does.

const (
	MaxBrandingColorBytes      = 128
	MaxBrandingFontFamilyBytes = 256
	MaxBrandingURLBytes        = 2048
)

// Hex notation in its four legal widths.
var brandingHexColor = regexp.MustCompile(`^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)

// Colour functions CSS defines. `url` is absent by construction rather than by
// exclusion: it is not a colour function, so an allowlist of colour functions
// never admits it, and a token substituted into `background` cannot fetch.
var brandingColorFunctions = map[string]struct{}{
	"rgb":       {},
	"rgba":      {},
	"hsl":       {},
	"hsla":      {},
	"hwb":       {},
	"lab":       {},
	"lch":       {},
	"oklab":     {},
	"oklch":     {},
	"color":     {},
	"color-mix": {},
}

// What may appear between a colour function's parentheses: numbers, units,
// separators, keywords such as `in oklab`, hex arguments, and nested colour
// functions. No quotes, semicolons, braces, backslashes or comment markers.
var brandingColorArgs = regexp.MustCompile(`^[0-9a-zA-Z%.,+\-/ ()#]*$`)

// A bare colour name. Which names CSS actually knows is the browser's
// business, not ours: an unknown one paints nothing, and every name of this
// shape is inert inside a declaration whatever it spells. Carrying the 148
// Level 4 names here — and again in the CLI mirror — bought a typo message and
// two tables to keep.
var brandingColorName = regexp.MustCompile(`^[a-zA-Z]{3,24}$`)

// Font stack items that are not quoted: one or more identifiers separated by
// single spaces, which covers both `Helvetica Neue` and `ui-sans-serif`.
var brandingFontIdent = regexp.MustCompile(`^[A-Za-z0-9_\-]+( [A-Za-z0-9_\-]+)*$`)

// ValidateBrandingColor accepts hex, a colour name, or a colour function.
func ValidateBrandingColor(field, value string) error {
	if len(value) > MaxBrandingColorBytes {
		return ErrBrandingInvalid(
			fmt.Sprintf("%s exceeds %d bytes", field, MaxBrandingColorBytes), nil)
	}
	if strings.TrimSpace(value) == "" {
		return ErrBrandingInvalid(
			fmt.Sprintf("%s is blank; omit the key to keep the maintained default", field), nil)
	}
	// Not trimmed: the value is stored and painted verbatim, and the contract
	// pattern has no room for padding either.
	if brandingHexColor.MatchString(value) {
		return nil
	}
	if brandingColorName.MatchString(value) {
		return nil
	}
	if isBrandingColorFunction(strings.ToLower(value)) {
		return nil
	}
	return ErrBrandingInvalid(fmt.Sprintf(
		"%s is not a colour: use hex (#4F46E5), a CSS colour name, or a colour function such as rgb(), hsl() or oklch()",
		field), nil)
}

func isBrandingColorFunction(value string) bool {
	open := strings.IndexByte(value, '(')
	if open <= 0 || !strings.HasSuffix(value, ")") {
		return false
	}
	if _, ok := brandingColorFunctions[value[:open]]; !ok {
		return false
	}
	args := value[open+1 : len(value)-1]
	if !brandingColorArgs.MatchString(args) {
		return false
	}
	// Nested functions are legal (`color-mix(in srgb, rgb(1 2 3), red)`), so the
	// parentheses only have to balance. Depth is bounded so a pathological value
	// cannot be stored as a nesting bomb.
	depth := 0
	for _, r := range args {
		switch r {
		case '(':
			depth++
			if depth > 4 {
				return false
			}
		case ')':
			depth--
			if depth < 0 {
				return false
			}
		}
	}
	return depth == 0
}

// ValidateBrandingFontFamily accepts a CSS font stack: comma-separated family
// names, each either a quoted string or a run of identifiers.
func ValidateBrandingFontFamily(value string) error {
	if len(value) > MaxBrandingFontFamilyBytes {
		return ErrBrandingInvalid(
			fmt.Sprintf("typography.font_family exceeds %d bytes", MaxBrandingFontFamilyBytes), nil)
	}
	if strings.TrimSpace(value) == "" {
		return ErrBrandingInvalid(
			"typography.font_family is blank; omit the key to keep the maintained default", nil)
	}
	for _, family := range strings.Split(value, ",") {
		// Spaces around a comma are how the stack is normally written; other
		// whitespace is not, and the contract pattern does not admit it.
		if err := validateBrandingFontName(strings.Trim(family, " ")); err != nil {
			return err
		}
	}
	return nil
}

func validateBrandingFontName(family string) error {
	invalid := ErrBrandingInvalid(fmt.Sprintf(
		"typography.font_family contains %q, which is not a font name: use identifiers (Inter, ui-sans-serif) or a quoted name (\"APK Futural\"), separated by commas",
		family), nil)
	if family == "" {
		return invalid
	}
	if quote := family[0]; quote == '"' || quote == '\'' {
		// A quoted name ends at its matching quote and contains no other, so it
		// cannot leave the string it opened.
		if len(family) < 2 || family[len(family)-1] != quote {
			return invalid
		}
		inner := family[1 : len(family)-1]
		if strings.ContainsRune(inner, rune(quote)) || strings.ContainsAny(inner, "\\;{}") {
			return invalid
		}
		return nil
	}
	if !brandingFontIdent.MatchString(family) {
		return invalid
	}
	return nil
}
