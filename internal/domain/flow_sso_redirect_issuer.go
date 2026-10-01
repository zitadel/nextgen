package domain

import "context"

// FlowSSORedirectIssuer issues the redirect that begins an external sign-in
// on an auth attempt: it pins the connection the slug names at its newest
// revision, issues the single-use state record and builds the authorize
// URL the browser is sent to.
//
// errors: [ErrIDPConnectionNotFound] when no connection in the project has
// the slug; [ErrFlowSSOUnavailable] when the connection cannot be served,
// with the engine's error as the log-only cause; the attempt errors of
// [FlowAuthAttemptService] and [ErrInternal] pass through.
type FlowSSORedirectIssuer interface {
	Issue(ctx context.Context, in FlowIssueSSORedirectInput) (FlowSSORedirectOutput, error)
}

// FlowIssueSSORedirectInput names the provider the user picked and what the
// API derived from the request: the callback route the provider redirects
// to and the page the browser returns to once the callback has run.
type FlowIssueSSORedirectInput struct {
	ProjectID    string
	AttemptID    string
	ProviderSlug string
	RedirectURI  string
	ReturnTarget string
}

// FlowSSORedirectOutput is the authorize URL and the nonce the handler sets
// as the browser-binding cookie; the state record keeps the nonce's hash.
type FlowSSORedirectOutput struct {
	RedirectURL  string
	BindingNonce string
}
