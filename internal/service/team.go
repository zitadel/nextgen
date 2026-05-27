package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type CreateTeamInput struct {
	ProjectID string
}

// ---- Secondary ports -------------------------------------------------------------

type TeamService struct {
	pool     database.Pool
	teamRepo domain.TeamRepository
}

func NewTeamService(
	pool database.Pool,
	teamRepo domain.TeamRepository,
) *TeamService {
	return &TeamService{
		pool:     pool,
		teamRepo: teamRepo,
	}
}

func (s *TeamService) CreateTeam(ctx context.Context, input CreateTeamInput) (*domain.Team, error) {
	tx, txErr := s.pool.Begin(ctx, nil)
	if txErr != nil {
		return nil, domain.ErrInternal(txErr).WithMessage("failed to start transaction")
	}
	defer func() {
		if txErr != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	model := &domain.Team{
		ProjectID: input.ProjectID,
	}

	err := s.teamRepo.Create(ctx, tx, model)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create team in database")
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return model, nil
}

func (s *TeamService) GetTeam(ctx context.Context, projectID string, teamID string) (*domain.Team, error) {
	team, err := s.teamRepo.Get(ctx, s.pool, projectID, teamID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrTeamNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get team from database")
	}
	return team, nil
}
