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
)

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
		{"branding.yaml", "logo_url", asBodyField("logo_url")},
		{"branding.yaml", "hero_url", asBodyField("hero_url")},
		{"branding-theme-side.yaml", "logo_url", func(value string) []byte {
			return mustJSON(map[string]any{"theme": map[string]any{"light": map[string]any{"logo_url": value}}})
		}},
		{"branding-typography.yaml", "font_url", func(value string) []byte {
			return mustJSON(map[string]any{"typography": map[string]any{"font_url": value}})
		}},
	}
	for _, field := range fields {
		t.Run(field.file+"/"+field.field, func(t *testing.T) {
			pattern := regexp.MustCompile(specPattern(t, field.file, field.field))
			for _, value := range urlCorpus() {
				var branding api.Branding
				accepted := branding.Decode(jx.DecodeBytes(field.body(value))) == nil
				if pattern.MatchString(value) && !accepted {
					t.Errorf("the pattern accepts %q but the server's URL parser refuses it", value)
				}
			}
		})
	}
}

func asBodyField(name string) func(string) []byte {
	return func(value string) []byte {
		return mustJSON(map[string]any{name: value})
	}
}

func mustJSON(value any) []byte {
	out, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return out
}

// specPattern reads the pattern of a field from the spec source, which is the
// text every generated client and the CLI compile.
func specPattern(t *testing.T, file, field string) string {
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

// urlCorpus is every ASCII character in every position of a URL, every
// percent-escape, a few non-ASCII characters, and the shapes of host, port and
// IPv6 literal the spec's pattern has to take a side on.
func urlCorpus() []string {
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
