package service

import "github.com/zitadel/nextgen/internal/domain"

type SettingsService interface {
	GetSetting(requester domain.SettingOwner, path string) (*domain.SettingLeaf, error)
	GetSettings(requester domain.SettingOwner, path []string) (map[string]any, error)
}

type settingsService struct {
}

func (s settingsService) GetSetting(requester domain.SettingOwner, path string) (*domain.SettingLeaf, error) {
	panic("implement me")
}

func (s settingsService) GetSettings(requester domain.SettingOwner, paths []string) (map[string]any, error) {
	panic("implement me")
}
