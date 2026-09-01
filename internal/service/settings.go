package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// SettingsService resolves settings for a requester. A setting is stored as
// leaves written at different owner levels (root, project, team, application,
// user); reading one means picking the leaf nearest to the requester that the
// requester is allowed to see, which is [domain.Setting.Resolve].
//
// Storage already restricts leaves to the requester's own branch, so a sibling
// team's value can never reach a resolution here.
type SettingsService interface {
	// GetSetting resolves one path. It returns [domain.ErrSettingNotFound] when
	// no leaf applies to the requester, which is an ordinary outcome for a
	// setting nobody has written yet.
	GetSetting(ctx context.Context, requester domain.SettingOwner, path domain.SettingsPath) (*domain.SettingLeaf, error)
	// GetSettings resolves many paths in one round trip, keyed by path. Paths
	// with no applicable leaf are absent from the map rather than present with a
	// nil value, so a caller can tell "unset" from "set to null" and fall back to
	// its own default per path.
	GetSettings(ctx context.Context, requester domain.SettingOwner, paths ...domain.SettingsPath) (map[string]any, error)
}

type settingsService struct {
	v2Pool *DB
}

func NewSettingsService(v2Pool *DB) SettingsService {
	return &settingsService{v2Pool: v2Pool}
}

func (s *settingsService) GetSetting(ctx context.Context, requester domain.SettingOwner, path domain.SettingsPath) (*domain.SettingLeaf, error) {
	settings, err := s.v2Pool.Statements().GetSettings(ctx, requester, path)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get setting from database")
	}

	for _, setting := range settings {
		if setting.Path != path {
			continue
		}
		if leaf := setting.Resolve(requester); leaf != nil {
			return leaf, nil
		}
	}

	return nil, domain.ErrSettingNotFound()
}

func (s *settingsService) GetSettings(ctx context.Context, requester domain.SettingOwner, paths ...domain.SettingsPath) (map[string]any, error) {
	settings, err := s.v2Pool.Statements().GetSettings(ctx, requester, paths...)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get settings from database")
	}

	m, err := domain.SettingList(settings).ToMap(requester)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to convert settings to map")
	}
	return m, nil
}
