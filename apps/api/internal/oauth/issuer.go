package oauth

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
)

// Issuer is one authorization server this handler serves: a project, at the
// URL a client fetched its metadata from.
type Issuer struct {
	ProjectID string
	// URL is the issuer identifier. For a customer project: the origin the
	// request arrived at, the proxy prefix it came through, Prefix and the
	// project ID. For the platform project: the public base and Prefix.
	URL *url.URL
	// Platform is set for the platform project, whose issuer is Prefix
	// itself on the server's public base.
	Platform bool
}

// Origin is the issuer's "scheme://host".
func (i Issuer) Origin() string {
	return i.URL.Scheme + "://" + i.URL.Host
}

// Admission decides whether origin may be an issuer of the project: a
// primary origin of the project, or a loopback one. It returns an error
// that means "no", or a server fault when it could not decide.
type Admission interface {
	Admit(ctx context.Context, projectID, origin string) error
}

// Settings are the OAuth settings of an issuer's project, and the deployment
// and release they were read from: the ones an authorization request at the
// issuer is served from (ADR 081 §10).
type Settings struct {
	Enabled      bool
	DeploymentID string
	ReleaseID    string
}

// SettingsSource reads the OAuth settings that apply to an issuer.
type SettingsSource interface {
	Get(ctx context.Context, issuer Issuer) (Settings, error)
}

// NotEnabled is the SettingsSource of a server that has OAuth enabled for
// no project.
type NotEnabled struct{}

func (NotEnabled) Get(context.Context, Issuer) (Settings, error) {
	return Settings{}, nil
}

// DenyAll is the Admission of a server that admits no origin as an issuer.
type DenyAll struct{}

func (DenyAll) Admit(context.Context, string, string) error {
	return domain.ErrOriginNotFound()
}

// issuerKey is the context key of the issuerState withIssuer records.
type issuerKey struct{}

// issuerState is what withIssuer found: the issuer, or the error that
// means there is none for this request.
type issuerState struct {
	issuer Issuer
	err    error
}

// IssuerFromContext returns the issuer withIssuer derived and admitted for
// the request, or false when the request has none.
func IssuerFromContext(ctx context.Context) (Issuer, bool) {
	state, ok := ctx.Value(issuerKey{}).(issuerState)
	if !ok || state.err != nil {
		return Issuer{}, false
	}
	return state.issuer, true
}

// issuerError returns why the request has no issuer, or nil when it has one.
// A request withIssuer never saw has none either.
func issuerError(ctx context.Context) error {
	state, ok := ctx.Value(issuerKey{}).(issuerState)
	if !ok {
		return domain.ErrOriginNotFound()
	}
	return state.err
}

// withIssuer derives the issuer of the request from the tenant the library
// set and the forwarded headers, asks the Admission for it, and puts it on
// the context: under its own key and as the library's issuer. When there
// is none it records why and lets the request continue, because a
// back-channel request carries no forwarded headers and never derives an
// issuer from them. Each method decides for itself what no issuer means.
func (s *server) withIssuer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		var state issuerState
		state.issuer, state.err = s.deriveIssuer(r, op.TenantFromContext(ctx))
		if state.err == nil {
			state.err = s.admission.Admit(ctx, state.issuer.ProjectID, state.issuer.Origin())
		}
		if state.err == nil {
			ctx = op.ContextWithIssuer(ctx, state.issuer.URL.String())
		} else {
			state.issuer = Issuer{}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, issuerKey{}, state)))
	})
}

// deriveIssuer builds the issuer of a request to tenant. The empty tenant
// is the platform project's issuer, only when a platform project is
// configured; any other tenant must be a project ID. A project's URL is the
// one the client fetched: the forwarded origin, normalized, the forwarded
// prefix and Prefix, then the project ID. The platform project's own ID is
// no tenant, because its issuer is Prefix itself.
func (s *server) deriveIssuer(r *http.Request, tenant string) (Issuer, error) {
	issuer := Issuer{ProjectID: tenant}
	switch {
	case tenant == "":
		if !s.platformEnabled {
			return Issuer{}, domain.ErrProjectNotFound()
		}
		issuer.ProjectID = domain.PlatformProjectID
		issuer.Platform = true
	case tenant == domain.PlatformProjectID, !domain.PrefixProject.Matches(tenant):
		return Issuer{}, domain.ErrProjectNotFound()
	}
	origin, err := domain.NormalizeOrigin(httputil.ForwardedOrigin(r))
	if err != nil {
		return Issuer{}, err
	}
	// NormalizeOrigin lets a `*` through for origin patterns; a request's
	// host is never one.
	if strings.Contains(origin, "*") {
		return Issuer{}, domain.ErrOriginInvalid()
	}
	if issuer.Platform {
		return s.platformIssuer(r, issuer, origin)
	}
	prefix, err := forwardedPrefix(r)
	if err != nil {
		return Issuer{}, err
	}
	issuer.URL, err = url.Parse(origin)
	if err != nil {
		return Issuer{}, domain.ErrOriginInvalid().WithParent(err)
	}
	issuer.URL.Path = prefix + Prefix + "/" + tenant
	return issuer, nil
}

// platformIssuer is the platform project's issuer: Prefix under the
// server's public base, path included, whatever path the request took
// after a proxy stripped that path. It is reached only directly at the
// public base's origin, never through an app, so a request at another
// origin or through the SDK proxy has none.
func (s *server) platformIssuer(r *http.Request, issuer Issuer, origin string) (Issuer, error) {
	base := strings.TrimRight(s.publicBase.Path, "/")
	switch strings.TrimSpace(r.Header.Get("X-Forwarded-Prefix")) {
	case "", base:
	default:
		return Issuer{}, domain.ErrOriginInvalid()
	}
	if origin != s.publicBase.Scheme+"://"+s.publicBase.Host {
		return Issuer{}, domain.ErrOriginInvalid()
	}
	issuer.URL = &url.URL{Scheme: s.publicBase.Scheme, Host: s.publicBase.Host, Path: base + Prefix}
	return issuer, nil
}

// forwardedPrefix is the path prefix the client's request carried before a
// proxy stripped it: "" when the client called the server directly, and the
// SDK proxy's prefix through a scaffolded app. The issuer must equal the
// URL the client fetched (RFC 8414 §3.3), and this server knows only those
// two prefixes, so any other value gives no issuer.
func forwardedPrefix(r *http.Request) (string, error) {
	prefix := strings.TrimSpace(r.Header.Get("X-Forwarded-Prefix"))
	switch prefix {
	case "", httputil.ProxyPrefix:
		return prefix, nil
	}
	return "", domain.ErrOriginInvalid()
}
