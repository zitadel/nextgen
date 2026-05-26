package repository

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func NewTeamRepository(client database.QueryExecutor) *TeamRepository {
	return &TeamRepository{}
}

type TeamRepository struct {
}

func (t TeamRepository) Create(ctx context.Context, client database.QueryExecutor, team *domain.Team) error {
	//TODO implement me
	panic("implement me")
}

func (t TeamRepository) GetById(ctx context.Context, client database.QueryExecutor, projectID string, teamID string) (*domain.Team, error) {
	//TODO implement me
	panic("implement me")
}
