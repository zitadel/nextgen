package oauth

import (
	"context"
	"errors"
	"net/url"
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
// project's own origins: a primary origin, matched literally, or a loopback
// origin for local development. A preview origin is never an issuer, and
// neither is the server's own origin, which only the platform project's
// issuer sits on.
type ProjectAdmission struct {
	projects projectReader
	// publicOrigin is the server's own origin, normalized: "" when the
	// public base is not an origin, in which case it is nobody's issuer.
	publicOrigin string
}

// NewProjectAdmission builds the admission over projects, with publicBase
// as the server's own address.
func NewProjectAdmission(projects service.ProjectService, publicBase *url.URL) *ProjectAdmission {
	return newProjectAdmission(projects, publicBase)
}

func newProjectAdmission(projects projectReader, publicBase *url.URL) *ProjectAdmission {
	a := &ProjectAdmission{projects: projects}
	if publicBase != nil {
		if origin, err := domain.NormalizeOrigin(publicBase.Scheme + "://" + publicBase.Host); err == nil {
			a.publicOrigin = origin
		}
	}
	return a
}

// Admit implements [Admission]. origin is normalized already, as
// deriveIssuer leaves it.
func (a *ProjectAdmission) Admit(ctx context.Context, projectID, origin string) error {
	origin = strings.TrimSpace(origin)
	if projectID == domain.PlatformProjectID {
		// The platform project's issuer is the server's public base and
		// nothing else: it is reached directly, never through an app.
		if a.publicOrigin == "" || origin != a.publicOrigin {
			return domain.ErrOriginNotFound()
		}
		return nil
	}
	if a.publicOrigin != "" && origin == a.publicOrigin {
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
	if domain.IsLoopbackOrigin(origin) {
		// A loopback origin is a developer's machine, admitted for local
		// development even when the project does not list it, unless the
		// project names it a preview: a preview is never an issuer, on
		// loopback or anywhere else. The settings source then still asks for
		// a deployment made to that exact origin.
		if _, preview := domain.MatchOrigin(originsOfKind(project.Origins, domain.OriginKindPreview), origin); preview {
			return domain.ErrOriginNotFound()
		}
		return nil
	}
	entry, ok := domain.MatchOrigin(originsOfKind(project.Origins, domain.OriginKindPrimary), origin)
	if !ok || entry.Pattern != origin {
		return domain.ErrOriginNotFound()
	}
	return nil
}

// originsOfKind keeps the entries of one kind, so that a primary origin is
// matched among primaries only and a preview pattern is recognized as what
// it is: it admits a browser to a preview deployment, never an issuer.
func originsOfKind(origins []domain.Origin, kind domain.OriginKind) []domain.Origin {
	kept := make([]domain.Origin, 0, len(origins))
	for _, origin := range origins {
		if origin.Kind == kind {
			kept = append(kept, origin)
		}
	}
	return kept
}

var _ Admission = (*ProjectAdmission)(nil)
