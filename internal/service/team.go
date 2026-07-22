package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type CreateTeamInput struct {
	ProjectID string
}

// ---- Secondary ports -------------------------------------------------------------

type TeamService struct {
	v2Pool *DB
}

func NewTeamService(v2Pool *DB) *TeamService {
	return &TeamService{
		v2Pool: v2Pool,
	}
}

func (s *TeamService) CreateTeam(ctx context.Context, input CreateTeamInput) (*domain.Team, error) {
	model, err := domain.NewTeam(input.ProjectID)
	if err != nil {
		return nil, err
	}

	if err := s.v2Pool.Statements().CreateTeam(ctx, model); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create team in database")
	}
	return model, nil
}

func (s *TeamService) GetTeam(ctx context.Context, projectID string, teamID string) (*domain.Team, error) {
	team, err := s.v2Pool.Statements().GetTeamByID(ctx, projectID, teamID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrTeamNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get team from database")
	}
	return team, nil
}
