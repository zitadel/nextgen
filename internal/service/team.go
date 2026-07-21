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

func (s *TeamService) CreateTeam(ctx context.Context, input CreateTeamInput) (team *domain.Team, err error) {
	model, err := domain.NewTeam(input.ProjectID)
	if err != nil {
		return nil, err
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateTeam(ctx, model); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create team in database")
		}
		return nil
	})
	if err != nil {
		var de domain.Error
		if errors.As(err, &de) {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
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
