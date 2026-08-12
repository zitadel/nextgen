package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const teamFieldCreatedAt = "created_at"

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

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateTeam(ctx, model); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeTeamCreated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  model.ProjectID,
			EntityType: "team",
			EntityID:   model.ID,
			Payload:    domain.TeamCreatedPayload{Name: model.Name},
		})
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			// Also catches a (project_id, id) primary key collision, which is
			// unreachable with generated IDs. Discriminating on the constraint
			// name would need Spanner to report one; today it returns "".
			return nil, domain.ErrTeamAlreadyExists().WithParent(err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
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

// ListTeamsRequest is the input for listing the teams of a project.
type ListTeamsRequest struct {
	// ProjectID restricts results to that project. Required: a team only has
	// meaning inside its project, so an unscoped team list is never valid.
	ProjectID string
	Limit     int
	PageToken string
	Sorting   *Sorting // optional; defaults to createdAt asc
	Filters   []Filter
}

// ListTeamsResponse is the output for listing teams.
type ListTeamsResponse struct {
	Teams         []*domain.Team
	NextPageToken string
}

// List returns the teams of a project, ordered and paginated with an opaque
// cursor token. The returned NextPageToken is empty when the last page has been
// reached. Teams of every status are returned; status is not filterable yet.
func (s *TeamService) List(ctx context.Context, req ListTeamsRequest) (*ListTeamsResponse, error) {
	if req.ProjectID == "" {
		return nil, domain.ErrTeamProjectNotFound()
	}

	filters := make([]database.Filter[domain.TeamField], 0, len(req.Filters)+1)
	filters = append(filters, database.Equal(database.Col(domain.TeamFieldProjectID), req.ProjectID))
	for _, f := range req.Filters {
		filter, err := teamFilter(f)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}

	orderBy, err := listOrderBy(req.Sorting, domain.TeamFieldCreatedAt, database.OrderAsc, teamField, domain.TeamFieldID)
	if err != nil {
		return nil, err
	}

	var cursor []byte
	if req.PageToken != "" {
		cursor = []byte(req.PageToken)
	}

	result, err := s.v2Pool.Statements().ListTeams(ctx, &database.ListOptions[domain.TeamField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.TeamField]{
			Limit:   uint32(normalizeLimit(req.Limit)),
			OrderBy: orderBy,
			Cursor:  cursor,
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list teams")
	}

	return &ListTeamsResponse{
		Teams:         result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// teamFilter maps an API filter predicate to a storage filter. Operations the
// v2 filter layer cannot express return [domain.ErrNotImplemented];
// invalid field/operation/value combinations return [domain.ErrRequestInvalid].
func teamFilter(f Filter) (database.Filter[domain.TeamField], error) {
	field, err := teamField(f.Field)
	if err != nil {
		return nil, err
	}
	return createdAtFilter(f.Operation, database.Col(field), f.Value)
}

// teamField maps an API field name to its [domain.TeamField].
func teamField(field string) (domain.TeamField, error) {
	switch field {
	case teamFieldCreatedAt:
		return domain.TeamFieldCreatedAt, nil
	default:
		return domain.TeamFieldUnspecified, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", field))
	}
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
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().UpdateTeam(ctx, team); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeTeamUpdated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  team.ProjectID,
			EntityType: "team",
			EntityID:   team.ID,
			Payload:    domain.TeamUpdatedPayload{ChangedKeys: []string{"name"}},
		})
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil, domain.ErrTeamAlreadyExists().WithParent(err)
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrTeamNotFound()
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to update team")
	}
	return team, nil
}

// Delete deactivates the team and cascades to its memberships and the users
// whose lifecycle it owns (ADR 024). The team is tombstoned, not erased, so it
// stays readable through [TeamService.Get] with status deactivated.
//
// Delete is idempotent: DeactivateTeam only touches an active team, so an
// unknown or already-deactivated team reports success without persisting any changes.
func (s *TeamService) Delete(ctx context.Context, projectID, teamID string) error {
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		changed, err := tx.Statements().DeactivateTeam(ctx, projectID, teamID)
		if err != nil {
			return err
		}
		if !changed {
			return nil
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeTeamDeactivated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  projectID,
			EntityType: "team",
			EntityID:   teamID,
		})
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return de
		}
		return domain.ErrInternal(err).WithMessage("failed to delete team")
	}
	return nil
}
