package oauth

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// projects is a fake projectReader holding one project.
type projects struct {
	project *domain.Project
	err     error
	calls   int
}

func (p *projects) Get(context.Context, string, service.ProjectQueryOptions) (*domain.Project, error) {
	p.calls++
	return p.project, p.err
}

// ownOrigins are the server's console origins: the public base's and an
// alias from server.console_origins.
var ownOrigins = []string{"https://api.example.com", "https://console.example.com"}

func appProject() *domain.Project {
	return &domain.Project{ID: "proj_app", Origins: []domain.Origin{
		{Pattern: "https://app.example.com", Kind: domain.OriginKindPrimary},
		{Pattern: "http://localhost:3000", Kind: domain.OriginKindPrimary},
		{Pattern: "https://*.preview.example.com", Kind: domain.OriginKindPreview},
		{Pattern: "https://pr-7.preview.example.com", Kind: domain.OriginKindPreview},
		{Pattern: "https://*.wild.example.com", Kind: domain.OriginKindPrimary},
		{Pattern: "http://127.0.0.1:9999", Kind: domain.OriginKindPreview},
		{Pattern: "https://console.example.com", Kind: domain.OriginKindPrimary},
	}}
}

func TestProjectAdmissionAdmitsListedPrimariesOnly(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name   string
		origin string
		want   error
	}{
		{name: "primary, literal", origin: "https://app.example.com"},
		{name: "loopback listed as a primary", origin: "http://localhost:3000"},
		{name: "loopback, unlisted", origin: "http://127.0.0.1:3000", want: domain.ErrOriginNotFound()},
		{name: "loopback listed as a preview", origin: "http://127.0.0.1:9999", want: domain.ErrOriginNotFound()},
		{name: "preview pattern", origin: "https://pr-1.preview.example.com", want: domain.ErrOriginNotFound()},
		{name: "preview, literal", origin: "https://pr-7.preview.example.com", want: domain.ErrOriginNotFound()},
		{name: "wildcard primary never matches literally", origin: "https://a.wild.example.com", want: domain.ErrOriginNotFound()},
		{name: "unknown host", origin: "https://evil.example.com", want: domain.ErrOriginNotFound()},
		{name: "the server's own origin", origin: "https://api.example.com", want: domain.ErrOriginNotFound()},
		{name: "a console alias listed as a primary", origin: "https://console.example.com", want: domain.ErrOriginNotFound()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			reader := &projects{project: appProject()}
			err := NewProjectAdmission(reader, ownOrigins).Admit(t.Context(), "proj_app", tt.origin)
			if tt.want == nil {
				assert.NoError(t, err)
				return
			}
			assert.ErrorIs(t, err, tt.want)
			assert.False(t, domain.IsServerFault(err))
		})
	}
}

// The server's own origins are refused before the project is read: they
// are the platform issuer's hosts and no customer project's.
func TestProjectAdmissionRefusesOwnOriginsWithoutReading(t *testing.T) {
	t.Parallel()
	for _, origin := range ownOrigins {
		reader := &projects{project: appProject()}
		err := NewProjectAdmission(reader, ownOrigins).Admit(t.Context(), "proj_app", origin)
		assert.ErrorIs(t, err, domain.ErrOriginNotFound(), origin)
		assert.Zero(t, reader.calls, origin)
	}
}

func TestProjectAdmissionPlatformIssuerIsOnOwnOrigins(t *testing.T) {
	t.Parallel()
	reader := &projects{project: appProject()}
	admission := NewProjectAdmission(reader, ownOrigins)

	assert.NoError(t, admission.Admit(t.Context(), domain.PlatformProjectID, "https://api.example.com"))
	assert.NoError(t, admission.Admit(t.Context(), domain.PlatformProjectID, "https://console.example.com"))
	assert.ErrorIs(t, admission.Admit(t.Context(), domain.PlatformProjectID, "https://app.example.com"), domain.ErrOriginNotFound())
	assert.ErrorIs(t, admission.Admit(t.Context(), domain.PlatformProjectID, "http://localhost:3000"), domain.ErrOriginNotFound())
	assert.Zero(t, reader.calls, "the platform project's origins are not consulted")

	noOrigins := NewProjectAdmission(reader, nil)
	assert.ErrorIs(t, noOrigins.Admit(t.Context(), domain.PlatformProjectID, "https://api.example.com"), domain.ErrOriginNotFound())
}

func TestProjectAdmissionProjectErrors(t *testing.T) {
	t.Parallel()

	t.Run("unknown project is no", func(t *testing.T) {
		t.Parallel()
		for _, readErr := range []error{new(database.NoRowFoundError), domain.ErrProjectNotFound()} {
			err := NewProjectAdmission(&projects{err: readErr}, ownOrigins).Admit(t.Context(), "proj_gone", "https://app.example.com")
			assert.ErrorIs(t, err, domain.ErrProjectNotFound())
			assert.False(t, domain.IsServerFault(err))
		}
	})

	t.Run("a fault stays a fault", func(t *testing.T) {
		t.Parallel()
		err := NewProjectAdmission(&projects{err: domain.ErrUnavailable()}, ownOrigins).Admit(t.Context(), "proj_app", "https://app.example.com")
		assert.ErrorIs(t, err, domain.ErrUnavailable())
		assert.True(t, domain.IsServerFault(err))
	})

	t.Run("an unclassified error is a fault", func(t *testing.T) {
		t.Parallel()
		err := NewProjectAdmission(&projects{err: errors.New("connection reset")}, ownOrigins).Admit(t.Context(), "proj_app", "https://app.example.com")
		require.Error(t, err)
		assert.True(t, domain.IsServerFault(err))
	})
}
