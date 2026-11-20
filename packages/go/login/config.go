package login

import (
	"fmt"
	"log/slog"
	"net/url"
	"strings"
)

// Config is what a host app knows about its Zitadel project: the three
// values `zitadel setup` writes to .env.local, where browsers reach the app,
// and where to go afterwards.
type Config struct {
	// ServerURL is the deployment's origin, ZITADEL_URL.
	ServerURL string
	// ProjectID is the project its users sign in to, ZITADEL_PROJECT_ID.
	ProjectID string
	// ProjectSecret authenticates the app's calls, ZITADEL_PROJECT_SECRET.
	ProjectSecret string
	// PublicOrigin is the origin browsers use to reach the app, such as
	// https://app.example.com: the API matches it against the project's
	// origins literally, and an https one makes the cookies Secure. It is
	// configured rather than read off the request, since behind a proxy the
	// request says neither.
	PublicOrigin string
	// Locale picks a built-in catalog (en, de, it); anything else reads as en.
	Locale string
	// PostSignInURL is where a signed-in user lands when the flow names no
	// redirect of its own; empty means the host's root.
	PostSignInURL string
	// Logger gets the detail of every failure the browser is told about only
	// generically; nil means slog.Default().
	Logger *slog.Logger
}

// Validate reports every required value that is missing, in one error, and
// a PublicOrigin that is not an http(s) origin.
func (c Config) Validate() error {
	var missing []string
	for _, v := range []struct{ name, value string }{
		{"ServerURL", c.ServerURL},
		{"ProjectID", c.ProjectID},
		{"ProjectSecret", c.ProjectSecret},
		{"PublicOrigin", c.PublicOrigin},
	} {
		if v.value == "" {
			missing = append(missing, v.name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("login: config is missing %s", strings.Join(missing, ", "))
	}
	u, err := url.Parse(c.PublicOrigin)
	// Round-trip rather than field-by-field: it is the one check that also
	// catches what url.Parse silently normalises away, such as an upper-case
	// scheme (which would then read as not secure) or a bare "?" that would
	// land in the middle of every URL built from this.
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		strings.HasSuffix(u.Host, ":") ||
		(&url.URL{Scheme: u.Scheme, Host: u.Host}).String() != c.PublicOrigin {
		return fmt.Errorf("login: config PublicOrigin %q is not an http(s) origin: scheme and host, nothing after", c.PublicOrigin)
	}
	return nil
}

func (c Config) secure() bool {
	return strings.HasPrefix(strings.ToLower(c.PublicOrigin), "https://")
}

func (c Config) logger() *slog.Logger {
	if c.Logger != nil {
		return c.Logger
	}
	return slog.Default()
}
