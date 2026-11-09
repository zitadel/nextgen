package oauth

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// runtimeResolver is what ReleaseSettings needs of the RuntimeResolver: the
// release deployed to an origin, or the newest primary one.
type runtimeResolver interface {
	Resolve(ctx context.Context, projectID, origin string) (*service.RuntimeResolution, error)
	ResolvePrimary(ctx context.Context, projectID string) (*service.RuntimeResolution, error)
}

// ReleaseSettings reads an issuer's OAuth settings from the release deployed
// to it: the newest deployment to the issuer's origin for a customer project
// (ADR 085), the newest primary deployment for the platform project. The
// release's `oauth` pin names the revision; no deployment, a revoked release
// or no pin means the authorization server is off there.
type ReleaseSettings struct {
	runtime  runtimeResolver
	settings service.OAuthSettingsReader
}

// NewReleaseSettings builds the source over the resolver the API serves
// flows with and the service that reads revisions.
func NewReleaseSettings(runtime *service.RuntimeResolver, settings *service.OAuthSettingsService) *ReleaseSettings {
	return newReleaseSettings(runtime, settings)
}

func newReleaseSettings(runtime runtimeResolver, settings service.OAuthSettingsReader) *ReleaseSettings {
	return &ReleaseSettings{runtime: runtime, settings: settings}
}

// Get implements [SettingsSource].
func (s *ReleaseSettings) Get(ctx context.Context, issuer Issuer) (Settings, error) {
	var (
		resolution *service.RuntimeResolution
		err        error
	)
	if issuer.Platform {
		resolution, err = s.runtime.ResolvePrimary(ctx, issuer.ProjectID)
	} else {
		resolution, err = s.runtime.Resolve(ctx, issuer.ProjectID, issuer.Origin())
	}
	if err != nil {
		return Settings{}, notDeployedIsOff(err)
	}
	if !issuer.Platform && !deployedToIssuer(resolution, issuer) {
		return Settings{}, nil
	}
	settings, err := service.ResolveOAuthSettings(ctx, s.settings, issuer.ProjectID, resolution.Release.Pins(domain.ReleasePointerKindOauth))
	if err != nil {
		return Settings{}, err
	}
	if settings == nil {
		return Settings{}, nil
	}
	return Settings{Enabled: settings.Enabled}, nil
}

// deployedToIssuer reports whether resolution is a primary deployment made
// to the issuer's own origin. The resolver also serves the newest primary
// deployment to the console's own origins, and a preview deployment to a
// preview origin; neither makes that origin an issuer, so the metadata stays
// off there whatever the release pins.
func deployedToIssuer(resolution *service.RuntimeResolution, issuer Issuer) bool {
	return resolution.Source == "origin" &&
		resolution.Origin == issuer.Origin() &&
		resolution.Deployment != nil &&
		resolution.Deployment.OriginKind == domain.DeploymentOriginKindPrimary
}

// notDeployedIsOff turns the resolver's refusals into "off": nothing
// deployed to the origin, no primary deployment, a revoked release, an
// origin the project does not list, or a project that does not exist. A
// server fault stays one, so the metadata handler answers 500 rather than
// telling a client the issuer does not exist; any other error is one this
// layer cannot classify, so it is a fault too.
func notDeployedIsOff(err error) error {
	if domain.IsServerFault(err) {
		return err
	}
	if _, ok := errors.AsType[domain.Error](err); ok {
		return nil
	}
	return domain.ErrInternal(err).WithMessage("failed to resolve the issuer's release")
}

var _ SettingsSource = (*ReleaseSettings)(nil)
