package oauth

import (
	"context"
	"fmt"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/domain"
)

// SigningKeys reads the public halves of a project's signing keys; the
// KeyService satisfies it.
type SigningKeys interface {
	GetProjectPublicSigningKeys(ctx context.Context, projectID string, purpose domain.SigningKeyPurpose) ([]jose.JSONWebKey, error)
}

// Keys serves the JWKS of the tenant's project: every token signing key a
// token it issued may still be signed with (ADR 039 §1). The tenant alone
// names the project, so the back-channel request on the public base, which
// derives no issuer, gets the same set as a request through the app. The
// project's newest primary deployment must have OAuth enabled, as every
// primary origin serves it; otherwise the set answers with the same status
// and body as a project that does not exist. The set goes away as soon as
// a release turns OAuth off, even while tokens it signed are unexpired: a
// project with OAuth off has no authorization server, and so no keys to
// verify against. An enabled project always has a token signing key (ADR
// 039), so an empty set is the server's fault. The keys are public, and
// the set is the same at every origin, so a shared cache may keep it for
// the configured max age; the Vary on the forwarded headers, which
// httputil.WithForwardedNoStore sets on every response, still makes it
// keep one copy per forwarded variant.
func (s opServer) Keys(ctx context.Context, _ *op.Request[struct{}]) (_ *op.Response, err error) {
	defer func() { keepError(ctx, err) }()
	projectID, _, err := tenantProject(op.TenantFromContext(ctx), s.platformEnabled)
	if err != nil {
		return nil, metadataError(err)
	}
	settings, err := s.settings.GetForNewestPrimaryDeployment(ctx, projectID)
	if err != nil {
		return nil, metadataError(err)
	}
	if !settings.Enabled {
		return nil, noMetadata()
	}
	keys, err := s.signingKeys.GetProjectPublicSigningKeys(ctx, projectID, domain.SigningKeyPurposeToken)
	if err != nil {
		return nil, metadataError(err)
	}
	if len(keys) == 0 {
		return nil, metadataError(domain.ErrSigningKeyNotFound())
	}
	response := op.NewResponse(jose.JSONWebKeySet{Keys: keys})
	response.Header.Set("Cache-Control", fmt.Sprintf("public, max-age=%d", int(s.jwksMaxAge.Seconds())))
	return response, nil
}
