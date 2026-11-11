package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/oauthsettings"
)

// CreateOAuthSettingsInput is the `oauth` resource of a release bundle.
type CreateOAuthSettingsInput struct {
	ProjectID string
	Enabled   bool
}

// OAuthSettingsService publishes and reads immutable OAuth settings
// revisions. A release build is the only writer: it reuses a revision whose
// content matches or inserts a new one, and pins it under `kind: oauth`.
type OAuthSettingsService struct {
	v2Pool *DB
}

func NewOAuthSettingsService(v2Pool *DB) *OAuthSettingsService {
	return &OAuthSettingsService{v2Pool: v2Pool}
}

// createOAuthSettings inserts a prepared revision and emits its event on
// stmts.
func (s *OAuthSettingsService) createOAuthSettings(ctx context.Context, stmts AllStatements, entity *domain.OAuthSettings) error {
	if err := stmts.CreateOAuthSettings(ctx, entity); err != nil {
		return err
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeOAuthSettingsCreated,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "oauth_settings",
		EntityID:   entity.ID,
		Payload:    domain.OAuthSettingsPayload{Enabled: entity.Enabled},
	})
}

// resolveOrCreateOAuthSettings reuses an existing revision whose content
// matches, preferring the newest, otherwise inserts the prepared revision.
func (s *OAuthSettingsService) resolveOrCreateOAuthSettings(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	prepared *domain.OAuthSettings,
) (*domain.OAuthSettings, error) {
	match, err := matchingOAuthSettings(ctx, stmts, projectID, prepared)
	if err != nil {
		return nil, err
	}
	if match != nil {
		return match, nil
	}
	if err := s.createOAuthSettings(ctx, stmts, prepared); err != nil {
		return nil, err
	}
	return prepared, nil
}

// matchingOAuthSettings returns the newest revision whose content equals
// want, or nil when none match. Scanning history lets Build reuse an older
// revision when the newest has diverged (on, off, on again).
func matchingOAuthSettings(ctx context.Context, stmts AllStatements, projectID string, want *domain.OAuthSettings) (*domain.OAuthSettings, error) {
	result, err := stmts.ListOAuthSettings(WithAuthzListUnrestricted(ctx), oauthsettings.ListOptions(projectID, maxHistoricalRevisions))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list oauth settings")
	}
	for _, item := range result.Items {
		if want.Equal(item) {
			return item, nil
		}
	}
	return nil, nil
}

// Get returns a single revision by id.
func (s *OAuthSettingsService) Get(ctx context.Context, projectID, id string) (_ *domain.OAuthSettings, err error) {
	ctx, end := startSpan(ctx, "OAuthSettingsService.Get")
	defer end(&err)

	entity, err := s.v2Pool.Statements().GetOAuthSettingsByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrOAuthSettingsNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get oauth settings revision from database")
	}
	return entity, nil
}

// OAuthSettingsReader is the revision lookup the OAuth server needs.
type OAuthSettingsReader interface {
	Get(ctx context.Context, projectID, id string) (*domain.OAuthSettings, error)
}

// ResolveOAuthSettings returns the revision a release's pins name, or nil
// when they pin none: a release without `oauth` leaves the authorization
// server off. A pin whose revision is missing is the server's inconsistency,
// not the caller's, and is reported as such.
func ResolveOAuthSettings(ctx context.Context, reader OAuthSettingsReader, projectID string, pins domain.ReleasePins) (*domain.OAuthSettings, error) {
	pin, ok := pins[domain.ReleaseOAuthHandle]
	if !ok {
		return nil, nil
	}
	settings, err := reader.Get(ctx, projectID, pin.RevisionID)
	if err != nil {
		if errors.Is(err, domain.ErrOAuthSettingsNotFound()) {
			return nil, domain.ErrInternal(err).WithMessage("pinned oauth settings revision is missing")
		}
		return nil, err
	}
	return settings, nil
}
