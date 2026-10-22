package api

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

type SecurityHandler struct {
	tokenService service.TokenService
	// platformProjectID is the deployment's platform project (ADR 075). A
	// session of a user homed there carries it in ScopeContext, which is what
	// opens the platform operator path; empty opens it for nobody.
	platformProjectID string
}

func NewSecurityHandler(
	tokenService service.TokenService,
) *SecurityHandler {
	return &SecurityHandler{
		tokenService: tokenService,
	}
}

// WithPlatformProject names the deployment's platform project (ADR 075). A
// chainable setter, like Handler's, so the constructor's call sites stay as
// they are.
func (s *SecurityHandler) WithPlatformProject(projectID string) *SecurityHandler {
	s.platformProjectID = projectID
	return s
}

func (s SecurityHandler) HandleOAuth2(ctx context.Context, operationName api.OperationName, t api.OAuth2) (context.Context, error) {
	if t.Token == "" {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}

	payload, err := s.tokenService.IntrospectToken(ctx, t.Token)
	if err != nil {
		return nil, introspectionFailure(err)
	}
	if !payload.Type.IsProjectSecret() {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}

	scope := ScopeContext{
		ProjectID:     payload.ProjectID,
		Scope:         payload.Scope,
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		// Project secrets are JWEs without a stable key id; the project id is
		// the durable principal for sk_proj grants (survives rotate/claim).
		PrincipalID: payload.ProjectID,
	}
	if secretHashOperations[operationName] {
		scope.SecretHash = domain.HashSecret(t.Token)
	}

	ctx = WithScopeContext(ctx, scope)
	ctx = withActorFromToken(ctx, payload)
	return ctx, nil
}

// HandleNextgenSession handles the nextgenSession security scheme: the
// __nextgen_session cookie. It verifies the cookie decrypts to a session
// token and stashes it for handlers. User-bound sessions mint ScopeContext
// so management ops can authorize the human, unless oauth2 already minted
// one (dual-scheme OR). Anonymous sessions skip the grant/user-query ops
// so a leftover building cookie cannot 401 a valid Bearer.
func (s SecurityHandler) HandleNextgenSession(ctx context.Context, operationName api.OperationName, t api.NextgenSession) (context.Context, error) {
	// A Bearer that already satisfied a dual-scheme operation is the
	// credential; the cookie is not consulted at all. Otherwise a stale or
	// malformed cookie riding along would fail here and 401 a request the
	// Bearer authorized. Session-only operations never get this far with a
	// ScopeContext, so they still validate the cookie below.
	if _, ok := GetScopeContext(ctx); ok {
		return ctx, nil
	}
	token, err := s.tokenService.IntrospectToken(ctx, t.APIKey)
	if err != nil {
		return nil, introspectionFailure(err)
	}
	err = domain.ValidateSessionToken(token)
	if err != nil {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	ctx = context.WithValue(ctx, sessionTokenKey{}, token)
	if token.UserID == "" && userBoundSessionOperations[operationName] {
		return ctx, ogenerrors.ErrSkipServerSecurity
	}
	// The cookie is the credential from here on, so a state-changing request
	// must pass the CSRF checks (ADR 053 §5). A Bearer that satisfied the
	// operation returned above and never reaches this.
	if err := checkSessionCSRF(ctx, operationName, t.APIKey); err != nil {
		return nil, err
	}
	ctx = context.WithValue(ctx, sessionCookieKey{}, t.APIKey)
	ctx = withActorFromToken(ctx, token)
	if token.UserID != "" {
		// Session.Token() never mints Scope (always empty). Users skip the
		// project.write ceiling in credentialCeiling; Check uses PrincipalType/ID.
		scope := ScopeContext{
			ProjectID:     token.ProjectID,
			Scope:         token.Scope,
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   token.UserID,
		}
		if s.platformProjectID != "" && token.ProjectID == s.platformProjectID {
			scope.PlatformProjectID = s.platformProjectID
		}
		ctx = WithScopeContext(ctx, scope)
	}
	return ctx, nil
}

var _ api.SecurityHandler = (*SecurityHandler)(nil)

// isRejectedToken reports whether a failed IntrospectToken judged the presented
// credential and rejected it (malformed, undecryptable, naming an unknown key,
// expired or revoked), rather than failing to decide. Every check that turns
// introspection into a refusal asks this, so the session cookie and the
// step-up proof refuse the same tokens.
func isRejectedToken(err error) bool {
	return errors.Is(err, domain.ErrInvalidToken()) ||
		errors.Is(err, domain.ErrInvalidTokenIdentifiers()) ||
		errors.Is(err, domain.ErrTokenRevoked()) ||
		errors.Is(err, domain.ErrEncryptionKeyNotFound())
}

// introspectionFailure decides what a failed IntrospectToken means for the
// request. Only a rejected credential ([isRejectedToken]) is an unsatisfied
// requirement: 401. Anything else means the server could not tell (the token
// store or key store failed), so it becomes an internal error and the error
// handler answers 500. Collapsing it into a 401 would tell every client its
// session is dead during an outage, and SDKs clear their session cookie on a
// 401.
func introspectionFailure(err error) error {
	if isRejectedToken(err) {
		return ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	if errors.Is(err, domain.ErrInternal(nil)) {
		return err
	}
	return domain.ErrInternal(err)
}

// sessionCookieOperations is the session-only 401 rewrite allowlist.
// Dual-scheme ops stay off it so a bad Bearer is not a missing-session message.
var sessionCookieOperations = map[api.OperationName]bool{
	api.GetMySessionOperation:          true,
	api.GetMySessionCsrfTokenOperation: true,
	api.RevokeMySessionOperation:       true,
	api.GetMyUserOperation:             true,
	api.PatchMyUserOperation:           true,
	api.CompleteClaimOperation:         true,
	api.ListMyProjectsOperation:        true,
	api.GetMyUserSchemaOperation:       true,
	api.ListMyTeamsOperation:           true,
	api.ListMyPasskeysOperation:        true,
	api.ListMyIdentityLinksOperation:   true,
	api.GetMyPasswordStateOperation:    true,
	api.GetMyPlatformAccessOperation:   true,
}

// userBoundSessionOperations require a session with UserID. Anonymous
// building cookies Skip so dual-scheme oauth2 can still satisfy. On a
// session-only operation nothing else can satisfy, so the skip becomes the 401
// the contract declares.
var userBoundSessionOperations = map[api.OperationName]bool{
	api.CreateGrantOperation:         true,
	api.GetGrantOperation:            true,
	api.DeleteGrantOperation:         true,
	api.QueryGrantsOperation:         true,
	api.QueryUsersOperation:          true,
	api.QueryTeamsOperation:          true,
	api.GetTeamOperation:             true,
	api.ListMyProjectsOperation:      true,
	api.GetMyUserSchemaOperation:     true,
	api.ListMyTeamsOperation:         true,
	api.ListMyPasskeysOperation:      true,
	api.ListMyIdentityLinksOperation: true,
	api.GetMyPasswordStateOperation:  true,
	api.GetProjectOperation:          true,
	api.PatchProjectOperation:        true,
	// A platform operator's view of the deployment (ADR 075 §6).
	api.QueryProjectsOperation:       true,
	api.GetMyPlatformAccessOperation: true,
	// Console management screens (#1300 §1). Their writes need the CSRF token
	// (ADR 053 §5, csrf.go).
	api.CreateUserOperation:            true,
	api.GetUserByIDOperation:           true,
	api.PatchUserByIDOperation:         true,
	api.ListUserTeamsOperation:         true,
	api.ListUserPasskeysOperation:      true,
	api.GetUserPasswordStateOperation:  true,
	api.ListUserIdentityLinksOperation: true,
	api.DeleteUserByIDOperation:        true,
	api.CreateTeamOperation:            true,
	api.UpdateTeamOperation:            true,
	api.ListSchemasOperation:           true,
	api.GetSchemaByIdOperation:         true,
	api.ListFlowDefinitionsOperation:   true,
	api.GetFlowDefinitionOperation:     true,
	api.ListBrandingOperation:          true,
	api.GetBrandingByIdOperation:       true,
	api.QueryIdpsOperation:             true,
	api.GetIdpByIdOperation:            true,
	api.GetIdpRevisionByIdOperation:    true,
}

// sessionUnauthorizedMessage mirrors the 401 descriptions of the
// cookie-secured operations in api/openapi.
const sessionUnauthorizedMessage = "Missing or invalid session token."

// secretHashOperations lists the operations whose handlers read
// ScopeContext.SecretHash: claim init stores it, claim status compares it
// (ADR 046 §3). An operation missing here gets an empty hash and the claim
// service answers 403, so a new claim leg must be added to this map.
var secretHashOperations = map[api.OperationName]bool{
	api.InitClaimOperation:      true,
	api.GetClaimStatusOperation: true,
}

type sessionTokenKey struct{}

// sessionCookieKey carries the raw __nextgen_session value of a request the
// cookie authenticated, so GET /sessions/me/csrf can derive its CSRF token.
type sessionCookieKey struct{}

func sessionCookieFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(sessionCookieKey{}).(string)
	return v, ok && v != ""
}

// sessionTokenFromContext returns the session token parsed from the
// __nextgen_session cookie by HandleNextgenSession.
func sessionTokenFromContext(ctx context.Context) (*domain.Token, bool) {
	v, ok := ctx.Value(sessionTokenKey{}).(*domain.Token)
	return v, ok && v != nil
}

// requireSelf resolves the caller of a self-access operation (`/me`). With
// project_id, a session of another project is refused first, whatever state it
// is in (holdSessionToProject). Any other refusal answers like a missing
// session, so it never tells a caller that its cookie is genuine but its user
// is gone (#553).
func requireSelf(ctx context.Context, projectID api.OptProjectID) (domain.Self, error) {
	token, ok := sessionTokenFromContext(ctx)
	if ok {
		if err := holdSessionToProject(token, projectID); err != nil {
			return domain.Self{}, err
		}
	}
	self, err := domain.SelfFromSession(token, time.Now())
	if err != nil {
		return domain.Self{}, invalidSessionCredential(err)
	}
	return self, nil
}

type contextKey struct{}

// requestHostKey is a context key for the effective request host injected
// by WithRequestHostMiddleware. Needed because same-origin browser fetches
// do not send the Origin header, so the handler falls back to this value.
type requestHostKey struct{}

// WithRequestHostMiddleware injects the effective request proto+host into the
// context so handlers can derive a WebAuthn RPID even when the browser omits
// the Origin header (same-origin fetches). A chain of proxies may send either
// forwarded header as a comma-separated list; its first entry is the one the
// client's request arrived with.
func WithRequestHostMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proto := firstForwarded(r.Header.Get("X-Forwarded-Proto"))
		if proto == "" {
			if r.TLS != nil {
				proto = "https"
			} else {
				proto = "http"
			}
		}
		host := firstForwarded(r.Header.Get("X-Forwarded-Host"))
		if host == "" {
			host = r.Host
		}
		if host != "" {
			ctx := context.WithValue(r.Context(), requestHostKey{}, proto+"://"+host)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// firstForwarded returns the first entry of a forwarded header that proxies
// may have appended to ("a.example, b.internal").
func firstForwarded(value string) string {
	first, _, _ := strings.Cut(value, ",")
	return strings.TrimSpace(first)
}

func requestOriginFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(requestHostKey{}).(string)
	return v, ok && v != ""
}

// cookieSecureFromContext reports whether Set-Cookie should include Secure.
//
// HTTPS requests (including TLS terminated upstream with X-Forwarded-Proto)
// keep Secure. Loopback HTTP — http://localhost / 127.0.0.0/8 / ::1 used by
// the CLI local runtime — omits it so Safari will store and send the cookie.
// Chrome and Firefox already accept Secure cookies on localhost; Safari does
// not (WebKit bug 232088). Non-loopback HTTP keeps Secure so a mis-set
// X-Forwarded-Proto fails closed rather than silently weakening cookies.
//
// When the request host was never injected (callers that skip
// WithRequestHostMiddleware), or the origin cannot be parsed, default to
// Secure=true so production-shaped paths stay locked down.
func cookieSecureFromContext(ctx context.Context) bool {
	origin, ok := requestOriginFromContext(ctx)
	if !ok {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" {
		return true
	}
	if strings.EqualFold(u.Scheme, "https") {
		return true
	}
	if strings.EqualFold(u.Scheme, "http") && isLoopbackHost(u.Hostname()) {
		return false
	}
	return true
}

// isLoopbackHost reports whether host is localhost or a loopback IP
// (127.0.0.0/8, ::1). Host must already be stripped of any port.
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type ScopeContext struct {
	// ProjectID is the credential's home project. For project secrets it equals
	// the managed project; for a Console session it is the session user's
	// project and may differ from the request target (ADR 053).
	ProjectID string
	// Scope carries the token's minted scopes verbatim (domain.Token.Scope):
	// project secrets hold project.write + project.read, preview secrets hold
	// project.read only. Session tokens mint an empty Scope.
	Scope []string
	// PrincipalType / PrincipalID identify the authz principal for resolver.Check.
	// OAuth2 project secrets are sk_proj with PrincipalID == ProjectID.
	// User-bound sessions are user with PrincipalID == token.UserID.
	PrincipalType domain.AuthzPrincipalType
	PrincipalID   string
	// TeamID is the token team for sk_team_ principals (resolver ConstraintTeamID).
	TeamID string
	// PlatformProjectID is the deployment's platform project when this is a
	// session of a user homed there (ADR 075), which adds the platform operator
	// path to every Check. Empty for every other credential.
	PlatformProjectID string
	// SecretHash is domain.HashSecret of the presented bearer string: the
	// proof-of-possession seam for the claim flow (ADR 046 §3). The claim
	// service stores it on init and compares it on status; it is set only on
	// those two operations.
	SecretHash string
}

func WithScopeContext(ctx context.Context, scopeCtx ScopeContext) context.Context {
	return context.WithValue(ctx, contextKey{}, scopeCtx)
}

func GetScopeContext(ctx context.Context) (ScopeContext, bool) {
	v, ok := ctx.Value(contextKey{}).(ScopeContext)
	return v, ok
}

func withActorFromToken(ctx context.Context, token *domain.Token) context.Context {
	if token == nil {
		return ctx
	}
	ac := audit.ActorContext{
		ProjectID:      token.ProjectID,
		TokenID:        token.TokenID,
		DelegationType: "direct",
		Authenticated:  true,
		SessionID:      token.SessionID,
	}
	if token.UserID != "" {
		uid := token.UserID
		ac.ActorID = &uid
		actorType := domain.EventActorTypeHuman
		if token.Type == domain.TokenTypePersonalAccessToken {
			actorType = domain.EventActorTypeService
		}
		ac.ActorType = &actorType
	} else {
		actorType := domain.EventActorTypeService
		ac.ActorType = &actorType
	}
	if reqID, ok := middleware.GetRequestIDContext(ctx); ok {
		ac.RequestID = &reqID
	}
	if rc, ok := middleware.GetRequestContext(ctx); ok {
		if rc.Fingerprint != "" {
			ac.Fingerprint = rc.Fingerprint
		}
		if rc.FlowID != "" {
			flowID := rc.FlowID
			ac.FlowID = &flowID
		}
		if rc.SessionID != "" && ac.SessionID == nil {
			sid := rc.SessionID
			ac.SessionID = &sid
		}
	}
	return audit.WithActorContext(ctx, ac)
}
