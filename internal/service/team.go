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
		ev := audit.WithEntity(
			audit.FromContext(ctx, domain.EventTypeTeamCreated, domain.EventCategoryAdmin),
			"team", model.ID,
		)
		if ev.ProjectID == "" {
			ev.ProjectID = model.ProjectID
		}
		ev, err := audit.WithPayload(ev, domain.TeamCreatedPayload{Name: model.Name})
		if err != nil {
			return err
		}
		return audit.Insert(ctx, tx.Statements(), ev)
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

	orderBy, err := teamOrderBy(req.Sorting)
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

// teamOrderBy builds the sort order, defaulting to createdAt ascending, and
// appends id as a tiebreaker so equal sort keys page deterministically.
func teamOrderBy(sorting *Sorting) (database.OrderBy[domain.TeamField], error) {
	sortField := domain.TeamFieldCreatedAt
	direction := database.OrderAsc

	if sorting != nil {
		if sorting.Field != "" {
			f, err := teamField(sorting.Field)
			if err != nil {
				return database.OrderBy[domain.TeamField]{}, err
			}
			sortField = f
		}
		dir, err := parseSortDirection(sorting.Direction)
		if err != nil {
			return database.OrderBy[domain.TeamField]{}, err
		}
		direction = dir
	}

	columns := []database.Column[domain.TeamField]{database.Col(sortField)}
	// id is unique within a project, so appending it gives the sort a total
	// order. Without it, rows sharing a sort-key value (e.g. equal createdAt)
	// have no stable order, and cursor pagination could skip or repeat them
	// across pages.
	if sortField != domain.TeamFieldID {
		columns = append(columns, database.Col(domain.TeamFieldID))
	}
	return database.OrderBy[domain.TeamField]{Columns: columns, Direction: direction}, nil
}

// teamFilter maps an API filter predicate to a storage filter. Operations the
// v2 filter layer cannot express return [domain.ErrNotImplemented];
// invalid field/operation/value combinations return [domain.ErrRequestInvalid].
func teamFilter(f Filter) (database.Filter[domain.TeamField], error) {
	field, err := teamField(f.Field)
	if err != nil {
		return nil, err
	}

	raw, ok := f.Value.(string)
	if !ok {
		return nil, domain.ErrRequestInvalid().WithDetails("createdAt filter value must be an RFC3339 string")
	}
	// The createdAt filter value arrives as an untyped string (the filter-value union in the openapi contract
	// does not specify a format for a timestamp); parse it into the time.Time needed for the comparison.
	value, err := database.CoerceTimeValue(raw)
	if err != nil {
		return nil, domain.ErrRequestInvalid().WithDetails(
			fmt.Sprintf("createdAt filter value %q is not a valid RFC3339 timestamp", raw))
	}
	return compareFilter(f.Operation, database.Col(field), value)
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
		ev := audit.WithEntity(
			audit.FromContext(ctx, domain.EventTypeTeamUpdated, domain.EventCategoryAdmin),
			"team", team.ID,
		)
		if ev.ProjectID == "" {
			ev.ProjectID = team.ProjectID
		}
		ev, err := audit.WithPayload(ev, domain.TeamUpdatedPayload{ChangedKeys: []string{"name"}})
		if err != nil {
			return err
		}
		return audit.Insert(ctx, tx.Statements(), ev)
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
		if err := tx.Statements().DeactivateTeam(ctx, projectID, teamID); err != nil {
			return err
		}
		ev := audit.WithEntity(
			audit.FromContext(ctx, domain.EventTypeTeamDeactivated, domain.EventCategoryAdmin),
			"team", teamID,
		)
		if ev.ProjectID == "" {
			ev.ProjectID = projectID
		}
		return audit.Insert(ctx, tx.Statements(), ev)
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return de
		}
		return domain.ErrInternal(err).WithMessage("failed to delete team")
	}
	return nil
}
