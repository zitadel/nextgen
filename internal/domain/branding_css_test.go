package domain

import (
	"strings"
	"testing"
)

func TestValidateBrandingColorAccepts(t *testing.T) {
	for _, value := range []string{
		"#fff",
		"#FFFF",
		"#4F46E5",
		"#4F46E5CC",
		"red",
		"RebeccaPurple",
		"currentColor",
		"transparent",
		"rgb(79 70 229)",
		"rgb(79, 70, 229)",
		"rgba(79 70 229 / 50%)",
		"hsl(243deg 75% 59%)",
		"oklch(0.7 0.15 250)",
		"color(display-p3 0.3 0.2 0.9)",
		"color-mix(in oklab, #4F46E5 40%, white)",
		"color-mix(in srgb, rgb(1 2 3), red)",
		// Not a CSS colour, but inert in a declaration — CSS drops it, and
		// keeping a table of 148 names to say so cost more than it bought.
		"reddish",
	} {
		t.Run(value, func(t *testing.T) {
			if err := ValidateBrandingColor("palette.primary", value); err != nil {
				t.Fatalf("ValidateBrandingColor(%q) = %v, want nil", value, err)
			}
		})
	}
}

func TestValidateBrandingColorRejects(t *testing.T) {
	for name, value := range map[string]string{
		// The reason the allowlist exists: the widget writes the value into a
		// CSS declaration, so a value carrying its own `}` opens a rule.
		"closes the declaration":  "red; } :host { display: none",
		"opens a block":           "red } :host {",
		"comment escape":          "red /* } */",
		"fetches a url":           "url(https://evil.example/beacon.png)",
		"url inside a function":   "color-mix(in srgb, url(https://evil.example/x), red)",
		"var indirection":         "var(--zl-primary)",
		"unbalanced parens":       "rgb(79 70 229",
		"unknown function":        "evil(1 2 3)",
		"quoted string":           `"red"`,
		"backslash escape":        `\72 ed`,
		"empty":                   "",
		"blank":                   "   ",
		"newline smuggles a rule": "red;\n} :host { display: none",
		"padded":                  "  #4F46E5  ",
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateBrandingColor("palette.primary", value); err == nil {
				t.Fatalf("ValidateBrandingColor(%q) = nil, want error", value)
			}
		})
	}
}

func TestValidateBrandingColorLengthCap(t *testing.T) {
	if err := ValidateBrandingColor("palette.primary", "#"+strings.Repeat("a", MaxBrandingColorBytes)); err == nil {
		t.Fatal("an over-long colour should be rejected")
	}
}

func TestValidateBrandingFontFamilyAccepts(t *testing.T) {
	for _, value := range []string{
		"Inter",
		"Inter, ui-sans-serif, sans-serif",
		"Helvetica Neue, Arial, sans-serif",
		`"APK Futural", Arimo, ui-sans-serif, system-ui, sans-serif`,
		"'Fira Code', ui-monospace, monospace",
	} {
		t.Run(value, func(t *testing.T) {
			if err := ValidateBrandingFontFamily(value); err != nil {
				t.Fatalf("ValidateBrandingFontFamily(%q) = %v, want nil", value, err)
			}
		})
	}
}

func TestValidateBrandingFontFamilyRejects(t *testing.T) {
	for name, value := range map[string]string{
		// font_family lands in `--zl-font-family-sans` the same way a colour
		// lands in `--zl-primary`, so it needs the same gate.
		"closes the declaration": "Inter; } :host { display: none",
		"unterminated quote":     `"Inter`,
		"quote inside a quote":   `"In"ter"`,
		"escape sequence":        `Inter\3b `,
		"function call":          "local(Inter)",
		"blank":                  "   ",
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateBrandingFontFamily(value); err == nil {
				t.Fatalf("ValidateBrandingFontFamily(%q) = nil, want error", value)
			}
		})
	}
}
