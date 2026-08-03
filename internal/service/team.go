package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type TeamService struct {
	v2Pool *DB
}

func NewTeamService(v2Pool *DB) *TeamService {
	return &TeamService{
		v2Pool: v2Pool,
	}
}

type CreateTeamInput struct {
	ProjectID string
	Name      string
}

func (s *TeamService) Create(ctx context.Context, input CreateTeamInput) (*domain.Team, error) {
	model, err := domain.NewTeam(input.ProjectID, input.Name)
	if err != nil {
		return nil, err
	}

	if err := s.v2Pool.Statements().CreateTeam(ctx, model); err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			// Also catches a (project_id, id) primary key collision, which is
			// unreachable with generated IDs. Discriminating on the constraint
			// name would need Spanner to report one; today it returns "".
			return nil, domain.ErrTeamAlreadyExists().WithParent(err)
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create team")
	}
	return model, nil
}

func (s *TeamService) Get(ctx context.Context, projectID string, teamID string) (*domain.Team, error) {
	team, err := s.v2Pool.Statements().GetTeamByID(ctx, projectID, teamID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrTeamNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get team")
	}
	return team, nil
}

type UpdateTeamInput struct {
	ProjectID string
	TeamID    string
	Name      *string
}

func (s *TeamService) Update(ctx context.Context, input UpdateTeamInput) (*domain.Team, error) {
	// Currently, only the name field can be updated.
	// In case there are more fields, a nil value would mean no change.
	if input.Name == nil {
		return nil, domain.ErrTeamNameInvalid()
	}
	name, err := domain.ValidateTeamName(*input.Name)
	if err != nil {
		return nil, err
	}
	team := &domain.Team{ProjectID: input.ProjectID, ID: input.TeamID, Name: name}
	if err := s.v2Pool.Statements().UpdateTeam(ctx, team); err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil, domain.ErrTeamAlreadyExists().WithParent(err)
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrTeamNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to update team")
	}
	return team, nil
}
