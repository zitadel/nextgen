package oauth

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// projectReader is the project lookup the admission needs; the
// ProjectService satisfies it.
type projectReader interface {
	Get(ctx context.Context, id string, opts service.ProjectQueryOptions) (*domain.Project, error)
}

// ProjectAdmission admits an origin as an issuer of a project from the
// project's own origins: a primary origin, matched literally. A preview
// origin is never an issuer, and neither is any of the server's own
// origins, which only the platform project's issuer sits on. An issuer on a
// primary origin assumes that origin's SDK proxy forwards only its own
// project's /__nextgen/oauth/{project} paths (issue #2931); Admit does not
// check that no other project lists the same origin.
type ProjectAdmission struct {
	projects projectReader
	// ownOrigins are the server's console origins, normalized, the public
	// base's first; empty when the server has none, in which case the
	// platform project has no issuer.
	ownOrigins []string
}

// NewProjectAdmission builds the admission over projects, with ownOrigins
// as the server's own console origins, normalized.
func NewProjectAdmission(projects projectReader, ownOrigins []string) *ProjectAdmission {
	return &ProjectAdmission{projects: projects, ownOrigins: ownOrigins}
}

// Admit implements [Admission]. origin is normalized already, as
// deriveIssuer leaves it.
func (a *ProjectAdmission) Admit(ctx context.Context, projectID, origin string) error {
	own := slices.Contains(a.ownOrigins, withoutDefaultPort(origin))
	if projectID == domain.PlatformProjectID {
		// The platform project's issuer sits on the server's own origins
		// and nothing else: it is reached directly, never through an app.
		if !own {
			return domain.ErrOriginNotFound()
		}
		return nil
	}
	if own {
		return domain.ErrOriginNotFound()
	}
	project, err := a.projects.Get(ctx, projectID, service.ProjectQueryOptions{})
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok || errors.Is(err, domain.ErrProjectNotFound()) {
			return domain.ErrProjectNotFound()
		}
		if domain.IsServerFault(err) {
			return err
		}
		return domain.ErrInternal(err).WithMessage("failed to read the project")
	}
	// A literal primary origin only: a preview or a wildcard is never an issuer.
	if !slices.ContainsFunc(project.Origins, func(o domain.Origin) bool {
		return o.Kind == domain.OriginKindPrimary && o.Pattern == origin
	}) {
		return domain.ErrOriginNotFound()
	}
	return nil
}

// withoutDefaultPort spells origin as a browser does, as the server's own
// origins are: https://host:443 is https://host.
func withoutDefaultPort(origin string) string {
	if rest, ok := strings.CutSuffix(origin, ":443"); ok && strings.HasPrefix(origin, "https://") {
		return rest
	}
	if rest, ok := strings.CutSuffix(origin, ":80"); ok && strings.HasPrefix(origin, "http://") {
		return rest
	}
	return origin
}

var _ Admission = (*ProjectAdmission)(nil)
