package service_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

func newMockedSettingsService(t *testing.T) (service.SettingsService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewSettingsService(service.NewPool(pool)), statements
}

// mustDomainError asserts err carries a domain error and returns it.
func mustDomainError(t *testing.T, err error) domain.Error {
	t.Helper()
	require.Error(t, err)
	var domErr domain.Error
	require.True(t, errors.As(err, &domErr))
	return domErr
}

var settingsRequester = domain.SettingOwner{
	ProjectID:     "project-1",
	TeamID:        "team-1",
	ApplicationID: "application-1",
	UserID:        "user-1",
}

func settingLeaf(owner domain.SettingOwner, value any, isFinal bool) *domain.SettingLeaf {
	return &domain.SettingLeaf{Owner: owner, Value: value, IsFinal: isFinal}
}

func TestSettingsServiceGetSettingResolvesNearestLeaf(t *testing.T) {
	svc, statements := newMockedSettingsService(t)

	statements.EXPECT().
		GetSettings(gomock.Any(), settingsRequester, "login.appearance").
		Return([]*domain.Setting{{
			ID: "login.appearance",
			Leafs: []*domain.SettingLeaf{
				settingLeaf(domain.SettingOwner{ProjectID: "project-1"}, "project-value", false),
				settingLeaf(domain.SettingOwner{ProjectID: "project-1", TeamID: "team-1"}, "team-value", false),
			},
		}}, nil)

	leaf, err := svc.GetSetting(t.Context(), settingsRequester, "login.appearance")
	require.NoError(t, err)
	assert.Equal(t, "team-value", leaf.Value)
}

// A final leaf higher up outranks anything written below it.
func TestSettingsServiceGetSettingHonoursFinal(t *testing.T) {
	svc, statements := newMockedSettingsService(t)

	statements.EXPECT().
		GetSettings(gomock.Any(), settingsRequester, "login.appearance").
		Return([]*domain.Setting{{
			ID: "login.appearance",
			Leafs: []*domain.SettingLeaf{
				settingLeaf(domain.SettingOwner{ProjectID: "project-1"}, "project-value", true),
				settingLeaf(settingsRequester, "user-value", false),
			},
		}}, nil)

	leaf, err := svc.GetSetting(t.Context(), settingsRequester, "login.appearance")
	require.NoError(t, err)
	assert.Equal(t, "project-value", leaf.Value)
}

func TestSettingsServiceGetSettingNotFoundWhenNoRows(t *testing.T) {
	svc, statements := newMockedSettingsService(t)

	statements.EXPECT().
		GetSettings(gomock.Any(), settingsRequester, "login.appearance").
		Return(nil, nil)

	_, err := svc.GetSetting(t.Context(), settingsRequester, "login.appearance")
	assert.Equal(t, domain.ErrSettingNotFound().Code, mustDomainError(t, err).Code)
}

// Storage admits every leaf on the requester's branch, including ones owned
// below it. Those resolve to nothing, which is still "not found" and must not
// surface as an empty leaf.
func TestSettingsServiceGetSettingNotFoundWhenOnlyDeeperLeaves(t *testing.T) {
	svc, statements := newMockedSettingsService(t)

	shallow := domain.SettingOwner{ProjectID: "project-1"}
	statements.EXPECT().
		GetSettings(gomock.Any(), shallow, "login.appearance").
		Return([]*domain.Setting{{
			ID:    "login.appearance",
			Leafs: []*domain.SettingLeaf{settingLeaf(settingsRequester, "user-value", false)},
		}}, nil)

	_, err := svc.GetSetting(t.Context(), shallow, "login.appearance")
	assert.Equal(t, domain.ErrSettingNotFound().Code, mustDomainError(t, err).Code)
}

func TestSettingsServiceGetSettingMapsStorageFailure(t *testing.T) {
	svc, statements := newMockedSettingsService(t)

	statements.EXPECT().
		GetSettings(gomock.Any(), settingsRequester, "login.appearance").
		Return(nil, assert.AnError)

	_, err := svc.GetSetting(t.Context(), settingsRequester, "login.appearance")
	assert.Equal(t, domain.ErrInternal(nil).Code, mustDomainError(t, err).Code)
}

func TestSettingsServiceGetSettingsResolvesEachPath(t *testing.T) {
	svc, statements := newMockedSettingsService(t)

	statements.EXPECT().
		GetSettings(gomock.Any(), settingsRequester, "login.appearance", "login.translations").
		Return([]*domain.Setting{
			{
				ID: "login.appearance",
				Leafs: []*domain.SettingLeaf{
					settingLeaf(domain.SettingOwner{ProjectID: "project-1"}, "project-value", false),
					settingLeaf(domain.SettingOwner{ProjectID: "project-1", TeamID: "team-1"}, "team-value", false),
				},
			},
			{
				ID:    "login.translations",
				Leafs: []*domain.SettingLeaf{settingLeaf(domain.SettingOwner{ProjectID: "project-1"}, "project-copy", false)},
			},
		}, nil)

	values, err := svc.GetSettings(t.Context(), settingsRequester, "login.appearance", "login.translations")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{
		"login.appearance":   "team-value",
		"login.translations": "project-copy",
	}, values)
}

// A path that resolves to nothing is absent from the map, so a caller can tell
// "unset" from "set to null".
func TestSettingsServiceGetSettingsOmitsUnresolvedPaths(t *testing.T) {
	svc, statements := newMockedSettingsService(t)

	shallow := domain.SettingOwner{ProjectID: "project-1"}
	statements.EXPECT().
		GetSettings(gomock.Any(), shallow, "set.path", "unset.path").
		Return([]*domain.Setting{
			{
				ID:    "set.path",
				Leafs: []*domain.SettingLeaf{settingLeaf(domain.SettingOwner{ProjectID: "project-1"}, nil, false)},
			},
			{
				ID:    "unset.path",
				Leafs: []*domain.SettingLeaf{settingLeaf(settingsRequester, "too-deep", false)},
			},
		}, nil)

	values, err := svc.GetSettings(t.Context(), shallow, "set.path", "unset.path")
	require.NoError(t, err)

	require.Contains(t, values, "set.path", "a leaf holding null is still set")
	assert.Nil(t, values["set.path"])
	assert.NotContains(t, values, "unset.path")
}

func TestSettingsServiceGetSettingsMapsStorageFailure(t *testing.T) {
	svc, statements := newMockedSettingsService(t)

	statements.EXPECT().
		GetSettings(gomock.Any(), settingsRequester, "login.appearance").
		Return(nil, assert.AnError)

	_, err := svc.GetSettings(t.Context(), settingsRequester, "login.appearance")
	assert.Equal(t, domain.ErrInternal(nil).Code, mustDomainError(t, err).Code)
}
