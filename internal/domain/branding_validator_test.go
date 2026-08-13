package domain

import (
	"strings"
	"testing"
)

func validBranding(t *testing.T) *Branding {
	t.Helper()
	return &Branding{
		ProjectID:      "proj_test",
		ID:             "brnd_test",
		Layout:         BrandingLayoutCentered,
		LiquidTemplate: `<div class="zl-shell">{% for f in fields %}<zl-field name="{{ f.name }}"></zl-field>{% endfor %}{% mandatory_gates %}</div>`,
		LogoURL:        "https://cdn.example.com/logo.svg",
	}
}

func TestValidateBranding(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*Branding)
		wantErr bool
	}{
		{name: "valid", mutate: func(b *Branding) {}},
		{name: "empty template is allowed", mutate: func(b *Branding) { b.LiquidTemplate = "" }},
		{name: "split layout", mutate: func(b *Branding) { b.Layout = BrandingLayoutSplit }},
		{name: "unknown layout", mutate: func(b *Branding) { b.Layout = "sidebar" }, wantErr: true},
		{name: "empty layout", mutate: func(b *Branding) { b.Layout = "" }, wantErr: true},
		{
			name:    "script tag",
			mutate:  func(b *Branding) { b.LiquidTemplate = `<div><SCRIPT src="https://evil.example">x</SCRIPT></div>` },
			wantErr: true,
		},
		{
			name:    "style tag",
			mutate:  func(b *Branding) { b.LiquidTemplate = `<style>:host{--zl-color-primary:red}</style>` },
			wantErr: true,
		},
		{
			name:    "inline event handler",
			mutate:  func(b *Branding) { b.LiquidTemplate = `<img src="x" onerror="steal()">` },
			wantErr: true,
		},
		{
			// HTML treats `/` between attributes as whitespace, so this parses
			// as a handler even though it contains no literal whitespace.
			name:    "inline event handler with slash separator",
			mutate:  func(b *Branding) { b.LiquidTemplate = `<img/onerror=alert(1)>` },
			wantErr: true,
		},
		{
			name: "liquid assignment that looks like a handler is fine",
			mutate: func(b *Branding) {
				b.LiquidTemplate = `{% assign online = true %}{% if online %}<p>hi</p>{% endif %}{% mandatory_gates %}`
			},
		},
		{
			name:    "javascript url",
			mutate:  func(b *Branding) { b.LiquidTemplate = `<a href="javascript:alert(1)">x</a>` },
			wantErr: true,
		},
		{
			name:    "raw filter",
			mutate:  func(b *Branding) { b.LiquidTemplate = `{{ step.name | raw }}` },
			wantErr: true,
		},
		{
			name:   "raw-prefixed filter name is fine",
			mutate: func(b *Branding) { b.LiquidTemplate = `{{ step.name | rawr }}{% mandatory_gates %}` },
		},
		{
			name:    "oversized template",
			mutate:  func(b *Branding) { b.LiquidTemplate = strings.Repeat("a", MaxBrandingTemplateBytes+1) },
			wantErr: true,
		},
		{
			name:    "invalid utf8",
			mutate:  func(b *Branding) { b.LiquidTemplate = "ok\xff" },
			wantErr: true,
		},
		{
			name:    "http logo url",
			mutate:  func(b *Branding) { b.LogoURL = "http://cdn.example.com/logo.svg" },
			wantErr: true,
		},
		{
			name:    "relative hero url",
			mutate:  func(b *Branding) { b.HeroURL = "/hero.png" },
			wantErr: true,
		},
		{
			// Loopback HTTP is the dev-posture carve-out: assets served from
			// the app's own dev server (same exception the cookie Secure flag
			// makes for the CLI local runtime).
			name:   "http localhost logo url allowed",
			mutate: func(b *Branding) { b.LogoURL = "http://localhost:3000/logo.svg" },
		},
		{
			name:   "http 127.0.0.1 hero url allowed",
			mutate: func(b *Branding) { b.HeroURL = "http://127.0.0.1:8080/hero.png" },
		},
		{
			name:   "http ipv6 loopback logo url allowed",
			mutate: func(b *Branding) { b.LogoURL = "http://[::1]:3000/logo.svg" },
		},
		{
			// Only loopback gets the http carve-out — a lookalike host or a
			// private-range IP stays https-only so a mis-typed production URL
			// fails closed.
			name:    "http localhost lookalike rejected",
			mutate:  func(b *Branding) { b.LogoURL = "http://localhost.evil.example/logo.svg" },
			wantErr: true,
		},
		{
			name:    "http private-range ip rejected",
			mutate:  func(b *Branding) { b.HeroURL = "http://192.168.1.10/hero.png" },
			wantErr: true,
		},
		{
			// Read-only in v1: even a well-formed https value is rejected —
			// the field would load an arbitrary stylesheet at document level.
			name:    "font url rejected even when https",
			mutate:  func(b *Branding) { b.FontURL = "https://fonts.example.com/css2" },
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := validBranding(t)
			tt.mutate(b)
			err := ValidateBranding(b)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ValidateBranding() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateBrandingAssetURLLoopbackParity(t *testing.T) {
	for _, value := range []string{
		"http://localhost:3000/logo.svg",
		"HTTP://LOCALHOST:3000/logo.svg",
		"http://127.0.0.1:8080/logo.svg",
		"http://127.255.255.255/logo.svg",
		"http://[::1]:3000/logo.svg",
	} {
		t.Run("accept "+value, func(t *testing.T) {
			if err := validateBrandingAssetURL("logo_url", value); err != nil {
				t.Fatalf("validateBrandingAssetURL() error = %v", err)
			}
		})
	}

	for _, value := range []string{
		"http://localhost.evil.example/logo.svg",
		"http://localhost:3000@evil.example/logo.svg",
		"http://192.168.1.10/logo.svg",
		"http://127.1/logo.svg",
		"http://2130706433/logo.svg",
		"http://0x7f000001/logo.svg",
		"http://127.00.0.1/logo.svg",
		"http://[0:0:0:0:0:0:0:1]/logo.svg",
		"http://[::ffff:127.0.0.1]/logo.svg",
		"http://localhost:/logo.svg",
		"http://localhost:65536/logo.svg",
	} {
		t.Run("reject "+value, func(t *testing.T) {
			if err := validateBrandingAssetURL("logo_url", value); err == nil {
				t.Fatal("validateBrandingAssetURL() succeeded, want error")
			}
		})
	}
}

func TestNewBrandingDefaultsLayout(t *testing.T) {
	b, err := NewBranding("proj_test", "", "", "", "", "")
	if err != nil {
		t.Fatalf("NewBranding() error = %v", err)
	}
	if b.Layout != BrandingLayoutCentered {
		t.Errorf("layout = %q, want %q", b.Layout, BrandingLayoutCentered)
	}
	if b.ID != "" {
		t.Errorf("id = %q, want empty until dialect create", b.ID)
	}
}

func TestNewBrandingRequiresProjectID(t *testing.T) {
	if _, err := NewBranding("", "", "", "", "", ""); err == nil {
		t.Fatal("NewBranding() with empty project id should fail")
	}
}
