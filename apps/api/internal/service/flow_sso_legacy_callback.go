package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
)

// FlowSSOLegacyCallbackInput is a provider redirect that arrived on a Zitadel
// v4 callback URL ([idp.LegacyCallbackPaths]).
type FlowSSOLegacyCallbackInput struct {
	// RequestURL is the URL the redirect arrived on: the browser-facing
	// scheme and host, and the path. Query and fragment are ignored.
	RequestURL string
	// State is the state query value, verbatim.
	State string
}

// FlowSSOLegacyCallbackOutput says where the callback that consumes the state
// runs.
type FlowSSOLegacyCallbackOutput struct {
	// ConnectionSlug is the connection the state pins.
	ConnectionSlug string
	// ReturnOrigin is the origin the sign-in started on. The binding cookie
	// lives there, so the real callback must run there too.
	ReturnOrigin string
}

// ResolveLegacy finds where a callback that arrived on a v4 callback URL must
// be finished, without consuming the state. It succeeds only when the state's
// authorize request sent exactly this URL as its redirect_uri, which happens
// only for a connection whose `oidc.redirect_uri` names it. The browser is
// then sent on to the return origin's own callback route with the query
// unchanged, where the state is consumed against the binding cookie as for
// any other sign-in. The target comes only from the stored record, whose
// origin was checked when the sign-in started, so the relay cannot be steered
// to another origin. Every failure is ErrSSOStateInvalid.
//
// errors: domain.ErrSSOStateInvalid, domain.ErrInternal
func (c *FlowSSOCallback) ResolveLegacy(ctx context.Context, in FlowSSOLegacyCallbackInput) (FlowSSOLegacyCallbackOutput, error) {
	projectID := domain.SSOStateProjectID(in.State)
	if projectID == "" {
		return FlowSSOLegacyCallbackOutput{}, domain.ErrSSOStateInvalid()
	}
	check, err := c.attempts.PeekSSOState(ctx, projectID, in.State)
	if err != nil {
		return FlowSSOLegacyCallbackOutput{}, err
	}
	pending := check.Pending
	if !sameCallbackURL(pending.RedirectURI, in.RequestURL) {
		getLoggingContext(ctx, "flow").Warn("sso legacy callback arrived on a URL the sign-in did not send",
			slog.String("project_id", projectID),
			slog.String("slug", pending.ProviderSlug),
		)
		return FlowSSOLegacyCallbackOutput{}, domain.ErrSSOStateInvalid()
	}
	// The target was checked when the sign-in started; it is parsed again
	// with the one check for URLs a browser is sent to.
	target, err := httputil.ParseRedirectTarget(pending.ReturnTarget)
	if err != nil {
		return FlowSSOLegacyCallbackOutput{}, domain.ErrInternal(fmt.Errorf("sso legacy callback: stored return target: %w", err))
	}
	return FlowSSOLegacyCallbackOutput{
		ConnectionSlug: pending.ProviderSlug,
		ReturnOrigin:   target.Scheme + "://" + target.Host,
	}, nil
}

// sameCallbackURL compares scheme, host and path. Scheme and host compare
// case-insensitively, as URLs do; the path must match exactly.
func sameCallbackURL(stored, arrived string) bool {
	a, err := url.Parse(stored)
	if err != nil {
		return false
	}
	b, err := url.Parse(arrived)
	if err != nil {
		return false
	}
	return strings.EqualFold(a.Scheme, b.Scheme) &&
		strings.EqualFold(a.Host, b.Host) &&
		a.EscapedPath() == b.EscapedPath()
}
