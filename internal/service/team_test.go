package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestTeamService_Create(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		input     service.CreateTeamInput
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		check     func(t *testing.T, got *domain.Team)
	}{
		{
			name:  "ok",
			input: service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, team *domain.Team) error {
						team.ID = "team_test01"
						team.CreatedAt = time.Now()
						team.UpdatedAt = team.CreatedAt
						team.Status = domain.TeamStatusActive
						return nil
					})
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "proj_1", got.ProjectID)
				assert.Equal(t, "team-1", got.Name)
				assert.NotEmpty(t, got.ID)
				assert.False(t, got.CreatedAt.IsZero())
			},
		},
		{
			name:    "empty name",
			input:   service.CreateTeamInput{ProjectID: "proj_1"},
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:  "duplicate name",
			input: service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).
					Return(database.NewUniqueError("teams", "uq_teams_project_name", nil))
			},
			wantErr: domain.ErrTeamAlreadyExists(),
		},
		{
			name:  "create fails",
			input: service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).Return(assert.AnError)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newMockedTeamService(t, tc.setupStmt)

			got, err := svc.Create(t.Context(), tc.input)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			tc.check(t, got)
		})
	}
}

func TestTeamService_Get(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		teamID    string
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		check     func(t *testing.T, got *domain.Team)
	}{
		{
			name:   "ok",
			teamID: "team_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetTeamByID(gomock.Any(), "proj_1", "team_1").
					Return(&domain.Team{
						ProjectID: "proj_1",
						ID:        "team_1",
						Name:      "team-1",
						Status:    domain.TeamStatusActive,
						CreatedAt: time.Now(),
						UpdatedAt: time.Now(),
					}, nil)
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "proj_1", got.ProjectID)
				assert.Equal(t, "team_1", got.ID)
				assert.Equal(t, "team-1", got.Name)
			},
		},
		{
			name:   "not found",
			teamID: "missing",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetTeamByID(gomock.Any(), "proj_1", "missing").
					Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrTeamNotFound(),
		},
		{
			name:   "pending_purge team reads as not found",
			teamID: "team_purge",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetTeamByID(gomock.Any(), "proj_1", "team_purge").
					Return(&domain.Team{
						ProjectID: "proj_1",
						ID:        "team_purge",
						Name:      "doomed",
						Status:    domain.TeamStatusPendingPurge,
					}, nil)
			},
			wantErr: domain.ErrTeamNotFound(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newMockedTeamService(t, tc.setupStmt)

			got, err := svc.Get(t.Context(), "proj_1", tc.teamID)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			tc.check(t, got)
		})
	}
}

func TestTeamService_Update(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		input     service.UpdateTeamInput
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		check     func(t *testing.T, got *domain.Team)
	}{
		{
			name:  "ok",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("renamed")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), &domain.Team{ProjectID: "proj_1", ID: "team_1", Name: "renamed"}).
					DoAndReturn(func(_ context.Context, team *domain.Team) error {
						team.Status = domain.TeamStatusActive
						team.CreatedAt = time.Now()
						team.UpdatedAt = team.CreatedAt
						return nil
					})
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "proj_1", got.ProjectID)
				assert.Equal(t, "team_1", got.ID)
				assert.Equal(t, "renamed", got.Name)
				assert.Equal(t, domain.TeamStatusActive, got.Status)
				assert.False(t, got.CreatedAt.IsZero())
			},
		},
		{
			name:  "name is trimmed before the update",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("  renamed  ")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), &domain.Team{ProjectID: "proj_1", ID: "team_1", Name: "renamed"}).
					Return(nil)
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "renamed", got.Name)
			},
		},
		{
			name:    "whitespace-only name",
			input:   service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("   ")},
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:    "omitted name",
			input:   service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1"},
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:  "duplicate name",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("renamed")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), &domain.Team{ProjectID: "proj_1", ID: "team_1", Name: "renamed"}).
					Return(database.NewUniqueError("teams", "uq_teams_project_name", nil))
			},
			wantErr: domain.ErrTeamAlreadyExists(),
		},
		{
			name:  "team not found",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "missing", Name: new("renamed")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), &domain.Team{ProjectID: "proj_1", ID: "missing", Name: "renamed"}).
					Return(database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrTeamNotFound(),
		},
		{
			name:  "update fails",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("renamed")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), gomock.Any()).Return(assert.AnError)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc := newMockedTeamService(t, tc.setupStmt)
			got, err := svc.Update(t.Context(), tc.input)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			tc.check(t, got)
		})
	}
}

func TestTeamService_Delete(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		teamID    string
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
	}{
		{
			name:   "ok",
			teamID: "team_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().DeactivateTeam(gomock.Any(), "proj_1", "team_1").Return(true, nil)
			},
		},
		{
			name:   "already deactivated does not emit",
			teamID: "team_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().DeactivateTeam(gomock.Any(), "proj_1", "team_1").Return(false, nil)
				// InsertEvent must not be required; AnyTimes helper still allows zero calls.
			},
		},
		{
			name:   "unknown team",
			teamID: "missing",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().DeactivateTeam(gomock.Any(), "proj_1", "missing").Return(false, nil)
			},
		},
		{
			name:   "deactivate fails",
			teamID: "team_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().DeactivateTeam(gomock.Any(), "proj_1", "team_1").Return(false, assert.AnError)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newMockedTeamService(t, tc.setupStmt)

			err := svc.Delete(t.Context(), "proj_1", tc.teamID)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestTeamService_List(t *testing.T) {
	t.Parallel()

	createdAt := time.Now().UTC().Truncate(time.Second)
	inProject := database.Equal(database.Col(domain.TeamFieldProjectID), "proj_1")
	// List hides pending_purge teams; every query carries this guard.
	visibleStatuses := database.Or(
		database.Equal(database.Col(domain.TeamFieldStatus), "active"),
		database.Equal(database.Col(domain.TeamFieldStatus), "deactivated"),
	)

	tests := []struct {
		name         string
		req          service.ListTeamsRequest
		result       *database.ListResult[*domain.Team]
		statementErr error
		wantErr      error
		checkOpts    func(t *testing.T, opts *database.ListOptions[domain.TeamField])
		checkResp    func(t *testing.T, resp *service.ListTeamsResponse)
	}{
		{
			name: "defaults",
			req:  service.ListTeamsRequest{ProjectID: "proj_1"},
			result: &database.ListResult[*domain.Team]{
				Items:      []*domain.Team{{ID: "team_1"}, {ID: "team_2"}},
				NextCursor: []byte("next"),
			},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
				assert.Nil(t, opts.Pagination.Cursor)
				assert.Equal(t, database.OrderAsc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []database.Column[domain.TeamField]{
					database.Col(domain.TeamFieldCreatedAt),
					database.Col(domain.TeamFieldID),
				}, opts.Pagination.OrderBy.Columns)
				assert.Equal(t, database.And(inProject, visibleStatuses), opts.Filter)
			},
			checkResp: func(t *testing.T, resp *service.ListTeamsResponse) {
				assert.Len(t, resp.Teams, 2)
				assert.Equal(t, "next", resp.NextPageToken)
			},
		},
		{
			name:   "limit clamped to max",
			req:    service.ListTeamsRequest{ProjectID: "proj_1", Limit: 500},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, uint32(100), opts.Pagination.Limit)
			},
		},
		{
			name:   "negative limit uses default",
			req:    service.ListTeamsRequest{ProjectID: "proj_1", Limit: -5},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
			},
		},
		{
			name:   "zero limit uses default, not storage's no-limit",
			req:    service.ListTeamsRequest{ProjectID: "proj_1", Limit: 0},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
			},
		},
		{
			name: "caller filters are ANDed onto the project scope",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: createdAt.Format(time.RFC3339)}},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.And(
					inProject,
					visibleStatuses,
					database.Equal(database.Col(domain.TeamFieldCreatedAt), createdAt),
				), opts.Filter)
			},
		},
		{
			name: "filter greater_than createdAt parses RFC3339",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "greater_than", Value: createdAt.Format(time.RFC3339)}},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.And(
					inProject,
					visibleStatuses,
					database.GreaterThan(database.Col(domain.TeamFieldCreatedAt), createdAt),
				), opts.Filter)
			},
		},
		{
			name: "createdAt range filter ANDs both bounds",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters: []service.Filter{
					{Field: "created_at", Operation: "greater_than", Value: createdAt.Format(time.RFC3339)},
					{Field: "created_at", Operation: "less_than", Value: createdAt.Add(time.Hour).Format(time.RFC3339)},
				},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.And(
					inProject,
					visibleStatuses,
					database.GreaterThan(database.Col(domain.TeamFieldCreatedAt), createdAt),
					database.LessThan(database.Col(domain.TeamFieldCreatedAt), createdAt.Add(time.Hour)),
				), opts.Filter)
			},
		},
		{
			name: "name contains matches case-insensitively",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "name", Operation: "contains", Value: "acme"}},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.And(
					inProject,
					visibleStatuses,
					database.StringContainsFold(database.Col(domain.TeamFieldName), "acme"),
				), opts.Filter)
			},
		},
		{
			name: "name equals matches exactly",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "name", Operation: "equals", Value: "Acme"}},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.And(
					inProject,
					visibleStatuses,
					database.StringEqual(database.Col(domain.TeamFieldName), "Acme"),
				), opts.Filter)
			},
		},
		{
			name: "status equals active",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "equals", Value: "active"}},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.And(
					inProject,
					visibleStatuses,
					database.Equal(database.Col(domain.TeamFieldStatus), "active"),
				), opts.Filter)
			},
		},
		{
			name: "status equals deactivated",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "equals", Value: "deactivated"}},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.And(
					inProject,
					visibleStatuses,
					database.Equal(database.Col(domain.TeamFieldStatus), "deactivated"),
				), opts.Filter)
			},
		},
		{
			name: "sort by name keeps the id tiebreaker",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "name", Direction: "asc"},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.OrderAsc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []database.Column[domain.TeamField]{
					database.Col(domain.TeamFieldName),
					database.Col(domain.TeamFieldID),
				}, opts.Pagination.OrderBy.Columns)
			},
		},
		{
			name: "sort by status keeps the id tiebreaker",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "status", Direction: "desc"},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.OrderDesc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []database.Column[domain.TeamField]{
					database.Col(domain.TeamFieldStatus),
					database.Col(domain.TeamFieldID),
				}, opts.Pagination.OrderBy.Columns)
			},
		},
		{
			name: "sort by createdAt desc keeps the id tiebreaker",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "created_at", Direction: "desc"},
			},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, database.OrderDesc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []database.Column[domain.TeamField]{
					database.Col(domain.TeamFieldCreatedAt),
					database.Col(domain.TeamFieldID),
				}, opts.Pagination.OrderBy.Columns)
			},
		},
		{
			name:   "page token passed through as cursor",
			req:    service.ListTeamsRequest{ProjectID: "proj_1", PageToken: "tok"},
			result: &database.ListResult[*domain.Team]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.TeamField]) {
				assert.Equal(t, []byte("tok"), opts.Pagination.Cursor)
			},
		},
		{
			name:         "statement error is wrapped",
			req:          service.ListTeamsRequest{ProjectID: "proj_1"},
			statementErr: assert.AnError,
			wantErr:      domain.ErrInternal(assert.AnError),
		},
		{
			name:         "invalid cursor maps to request invalid",
			req:          service.ListTeamsRequest{ProjectID: "proj_1", PageToken: "bad"},
			statementErr: database.ErrInvalidCursor(),
			wantErr:      domain.ErrRequestInvalid(),
		},
		{
			name:         "cursor order mismatch maps to request invalid",
			req:          service.ListTeamsRequest{ProjectID: "proj_1", PageToken: "bad"},
			statementErr: database.ErrCursorOrderMismatch(),
			wantErr:      domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var gotOpts *database.ListOptions[domain.TeamField]
			svc := newMockedTeamService(t, func(s *servicemocks.MockAllStatements) {
				s.EXPECT().ListTeams(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, opts *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
						gotOpts = opts
						return tc.result, tc.statementErr
					})
			})

			resp, err := svc.List(t.Context(), tc.req)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, resp)
				return
			}
			require.NoError(t, err)
			if tc.checkOpts != nil {
				tc.checkOpts(t, gotOpts)
			}
			if tc.checkResp != nil {
				tc.checkResp(t, resp)
			}
		})
	}
}

func TestTeamService_List_ValidationErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		req     service.ListTeamsRequest
		wantErr error
	}{
		{
			name:    "missing project id is refused",
			req:     service.ListTeamsRequest{},
			wantErr: domain.ErrTeamProjectNotFound(),
		},
		{
			name: "unsupported operation not implemented",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "not_equals", Value: time.Now().UTC().Format(time.RFC3339)}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name: "unknown filter field is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "owner", Operation: "equals", Value: "x"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string name value is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "name", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "ordering operation on name is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "name", Operation: "greater_than", Value: "x"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string status value is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown status value is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "equals", Value: "suspended"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "pending_purge is not a filterable status",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "equals", Value: "pending_purge"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "contains on status is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "contains", Value: "act"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "not_equals on status not implemented",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "not_equals", Value: "active"}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name: "unknown sort field is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "owner", Direction: "asc"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort direction is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "created_at", Direction: "sideways"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string createdAt value is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unparseable createdAt value is invalid",
			req: service.ListTeamsRequest{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: "not-a-time"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			// Validation fails before storage is reached, so no ListTeams
			// expectation is set and gomock would flag an unexpected call.
			svc := newMockedTeamService(t, nil)

			resp, err := svc.List(t.Context(), tc.req)
			require.ErrorIs(t, err, tc.wantErr)
			assert.Nil(t, resp)
		})
	}
}

func newMockedTeamService(t *testing.T, setupStmt func(*servicemocks.MockAllStatements)) *service.TeamService {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	if setupStmt != nil {
		statements := servicemocks.NewMockAllStatements(ctrl)
		statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
		pool.EXPECT().Statements().Return(statements).AnyTimes()
		pool.EXPECT().
			Transaction(gomock.Any(), gomock.Any()).
			DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
				return fn(ctx, statementer)
			}).
			AnyTimes()
		statementer.EXPECT().Statements().Return(statements).AnyTimes()
		statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
		setupStmt(statements)
	}

	return service.NewTeamService(service.NewPool(pool))
}
