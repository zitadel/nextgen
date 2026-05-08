package repository

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Project struct{}

func (p *Project) GetConfig(ctx context.Context, q database.QueryExecutor, projectID string) (*domain.ProjectConfig, error) {
	// TODO: actual implementation to fetch project config from database
	if projectID == "aa" {
		return &domain.ProjectConfig{
			DefaultRequiredChecks: []domain.AuthCheckType{},
		}, nil
	}
	return &domain.ProjectConfig{
		DefaultRequiredChecks: []domain.AuthCheckType{
			domain.AuthCheckTypeUser,
			domain.AuthCheckTypePassword,
		},
	}, nil
}
