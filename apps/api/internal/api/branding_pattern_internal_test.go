package api

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// The OpenAPI `pattern` on the appearance values is deliberately a superset of
// the domain allowlist: a regex cannot balance parentheses, so it pins the
// shape and the domain decides which of those shapes is a colour function it
// will run.
//
// Superset is the direction that has to hold. A pattern looser than the gate
// only means a caller gets the server's error instead of the client's; a
// pattern tighter than the gate rejects a colour the server would have stored,
// in generated clients we do not control. These tests pin that direction, so
// the two cannot drift apart in the wrong one.
func TestBrandingColorPatternAcceptsEverythingTheGateDoes(t *testing.T) {
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
	} {
		t.Run(value, func(t *testing.T) {
			require.NoError(t, domain.ValidateBrandingColor("palette.primary", value),
				"fixture is not a colour the gate accepts")
			palette := api.BrandingPalette{Primary: api.NewOptBrandingColor(api.BrandingColor(value))}
			require.NoError(t, palette.Validate(),
				"the contract pattern rejects a colour the server would store")
		})
	}
}

// The pattern carries the half of the gate that keeps a value inside its own
// CSS declaration, so generated clients refuse an injection without reaching
// the server at all.
func TestBrandingColorPatternRejectsInjection(t *testing.T) {
	for name, value := range map[string]string{
		"closes the declaration": "red; } :host { display: none",
		"opens a block":          "red } :host {",
		"comment escape":         "red /* } */",
		"fetches a url":          "url(https://evil.example/beacon.png)",
		"backslash escape":       `\72 ed`,
		"newline":                "red;\n} :host { display: none",
	} {
		t.Run(name, func(t *testing.T) {
			palette := api.BrandingPalette{Primary: api.NewOptBrandingColor(api.BrandingColor(value))}
			require.Error(t, palette.Validate())
		})
	}
}

func TestBrandingFontFamilyPatternAcceptsEverythingTheGateDoes(t *testing.T) {
	for _, value := range []string{
		"Inter",
		"Inter, ui-sans-serif, sans-serif",
		"Helvetica Neue, Arial, sans-serif",
		`"APK Futural", Arimo, ui-sans-serif, system-ui, sans-serif`,
		"'Fira Code', ui-monospace, monospace",
	} {
		t.Run(value, func(t *testing.T) {
			require.NoError(t, domain.ValidateBrandingFontFamily(value),
				"fixture is not a stack the gate accepts")
			typography := api.BrandingTypography{FontFamily: api.NewOptString(value)}
			require.NoError(t, typography.Validate(),
				"the contract pattern rejects a font stack the server would store")
		})
	}
}

func TestBrandingFontFamilyPatternRejectsInjection(t *testing.T) {
	for name, value := range map[string]string{
		"closes the declaration": "Inter; } :host { display: none",
		"unterminated quote":     `"Inter`,
		"escape sequence":        `Inter\3b `,
	} {
		t.Run(name, func(t *testing.T) {
			typography := api.BrandingTypography{FontFamily: api.NewOptString(value)}
			require.Error(t, typography.Validate())
		})
	}
}

// The branding URL fields are `format: uri`, which makes ogen decode them with
// url.ParseRequestURI and drop their patterns, so the server never applies the
// pattern. The CLI and the generated clients do, and `deploy` writes schemas and
// flows before branding, so a URL that passes the pattern but not the parser
// fails the deploy halfway. This pins the direction that matters: the pattern
// must never accept what the server's parser refuses. The pattern may be
// stricter (an empty port, a port above 65535), which only costs a dry run.
func TestBrandingURLPatternsNeverAcceptWhatTheServerRefuses(t *testing.T) {
	fields := []struct {
		file  string
		field string
		body  func(value string) []byte
	}{
		{"branding.yaml", "logo_url", brandingURLBodyField("logo_url")},
		{"branding.yaml", "hero_url", brandingURLBodyField("hero_url")},
		{"branding-theme-side.yaml", "logo_url", func(value string) []byte {
			return marshalBrandingURLBody(map[string]any{"theme": map[string]any{"light": map[string]any{"logo_url": value}}})
		}},
		{"branding-typography.yaml", "font_url", func(value string) []byte {
			return marshalBrandingURLBody(map[string]any{"typography": map[string]any{"font_url": value}})
		}},
	}
	for _, field := range fields {
		t.Run(field.file+"/"+field.field, func(t *testing.T) {
			pattern := regexp.MustCompile(brandingURLSpecPattern(t, field.file, field.field))

			// A pattern that matched nothing would never accept a URL the server
			// refuses, so an ordinary URL has to pass both.
			const ordinary = "https://cdn.example.com/logo.svg"
			var ordinaryBranding api.Branding
			require.True(t, pattern.MatchString(ordinary), "the pattern refuses an ordinary URL")
			require.NoError(t, ordinaryBranding.Decode(jx.DecodeBytes(field.body(ordinary))),
				"the server refuses an ordinary URL")

			var tooLoose []string
			for _, value := range brandingURLCorpus() {
				var branding api.Branding
				accepted := branding.Decode(jx.DecodeBytes(field.body(value))) == nil
				if pattern.MatchString(value) && !accepted {
					tooLoose = append(tooLoose, value)
				}
			}
			if len(tooLoose) > 0 {
				shown := tooLoose[:min(len(tooLoose), 10)]
				t.Errorf("the pattern accepts %d URLs the server's URL parser refuses, for example %q",
					len(tooLoose), shown)
			}
		})
	}
}

func brandingURLBodyField(name string) func(string) []byte {
	return func(value string) []byte {
		return marshalBrandingURLBody(map[string]any{name: value})
	}
}

func marshalBrandingURLBody(value any) []byte {
	out, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return out
}

// brandingURLSpecPattern reads the pattern of a field from the spec source, which is the
// text every generated client and the CLI compile.
func brandingURLSpecPattern(t *testing.T, file, field string) string {
	t.Helper()
	raw, err := os.ReadFile("../../api/openapi/components/flows/" + file)
	require.NoError(t, err)
	var doc struct {
		Properties map[string]struct {
			Pattern string `yaml:"pattern"`
		} `yaml:"properties"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &doc))
	pattern := doc.Properties[field].Pattern
	require.NotEmpty(t, pattern, "%s has no pattern for %s", file, field)
	return pattern
}

// brandingURLCorpus is every ASCII character in every position of a URL, every
// percent-escape, a few non-ASCII characters, and the shapes of host, port and
// IPv6 literal the spec's pattern has to take a side on.
func brandingURLCorpus() []string {
	var corpus []string
	for c := range 0x80 {
		ch := string(rune(c))
		corpus = append(corpus,
			"https://a"+ch+"b.example/x",
			"https://"+ch+"ab.example/x",
			"https://ab.example"+ch+"/x",
			"https://h.example/a"+ch+"b",
			"https://h.example/a?x"+ch+"y",
			"https://h.example/a#x"+ch+"y",
			"https://h.example?x"+ch+"y",
			"https://h.example#x"+ch+"y",
			"https://h.example:"+ch+"/x",
			"https://h.example:8"+ch+"/x",
		)
	}
	for c := range 0x100 {
		escape := fmt.Sprintf("%%%02X", c)
		corpus = append(corpus,
			"https://a"+escape+"b.example/x",
			"https://h.example/a"+escape+"b",
			"https://h.example/a?x"+escape+"y",
			"https://h.example/a#x"+escape+"y",
		)
	}
	for _, code := range []rune{0xe9, 0x4f8b, 0x1F600, 0xa0, 0x2028, 0xfeff, 0x85, 0x200b} {
		ch := string(code)
		corpus = append(corpus,
			"https://a"+ch+"b.example/x",
			"https://h.example/a"+ch+"b",
			"https://h.example/a?x"+ch+"y",
		)
	}
	for _, literal := range []string{"::1", "::", "1::", ":::", "1:2:3", "zz", "1.2.3.4", "fe80::1%25eth0", "", "2001:db8::1", "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8:9", "g::1", "::1.2.3", "1::2::3", "12345::1", "1:2:3:4:5:6:7::", "::2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8::", "1:2:3:4:5:6:7", "::ffff:192.0.2.1", "64:ff9b::192.0.2.1", "1:2:3:4:5:6:1.2.3.4", "::1.2.3.4", "1::1.2.3.4", "1:2:3:4:5:6:7:1.2.3.4", "::256.1.1.1", "::01.2.3.4", "1:2:3:4:5:6:7::1.2.3.4", "1:2:3:4:5::1.2.3.4"} {
		corpus = append(corpus, "https://["+literal+"]/x", "https://["+literal+"]:8443/x")
	}
	for _, port := range []string{"0", "1", "65535", "65536", "99999", "", "abc", "08080", "-1", "80a", "8 0"} {
		corpus = append(corpus, "https://h.example:"+port+"/x")
	}
	corpus = append(corpus,
		"https://", "https:///x", "https://x", "https://.", "https://h.example",
		"https://h.example/", "https://h.example?", "https://h.example#", "https://h.example/?#",
		"https://h.example/a/b/../c", "https://h.example//x", "https://h.example/a b",
		"https://-h.example/x", "https://h-.example/x", "https://h.example#frag",
		"https://h.example:8443#frag", "http://localhost#frag", "http://127.0.0.1:3000#frag",
	)
	return corpus
}
