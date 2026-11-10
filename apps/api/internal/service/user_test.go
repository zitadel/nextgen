package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

func TestUserService_ListUsers_ValidationErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   service.ListUsersInput
		wantErr error
	}{
		{
			name: "unknown filter field is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "owner", Operation: "equals", Value: "x"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort field is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "owner", Direction: "asc"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort direction is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "created_at", Direction: "sideways"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string id value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "id", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "ordering operation on schema is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "schema", Operation: "greater_than", Value: "sch_1"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "not_equals on id not implemented",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "id", Operation: "not_equals", Value: "usr_1"}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name: "unknown status value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "equals", Value: "retired"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "contains on status is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "contains", Value: "act"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "not_equals on status not implemented",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "status", Operation: "not_equals", Value: "active"}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			// The column is null for self-owned users and `= NULL` matches
			// nothing, so a null value must be refused rather than silently
			// returning an empty page.
			name: "null lifecycle owner value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "lifecycle_owner_team_id", Operation: "equals", Value: nil}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "identifier cannot be sorted by",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "identifier", Direction: "asc"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "ordering operation on identifier is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "less_than", Value: "alex"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "not_contains on identifier is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "not_contains", Value: "alex"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			// No index serves a substring match, so it is not offered.
			name: "contains on identifier is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "contains", Value: "alex"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "starts_with on a field other than identifier is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "id", Operation: "starts_with", Value: "user_"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			// A search comes back in the order of the search index.
			name: "sorting with an identifier filter is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "starts_with", Value: "alex"}},
				Sorting:   &service.Sorting{Field: "created_at", Direction: "desc"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "a second identifier filter is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters: []service.Filter{
					{Field: "identifier", Operation: "starts_with", Value: "alex"},
					{Field: "identifier", Operation: "starts_with", Value: "ben"},
				},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "an identifier value longer than the search text is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "starts_with", Value: strings.Repeat("a", domain.SearchTextMaxRunes+1)}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "equals on identifier is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "equals", Value: "alex"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "not_equals on identifier is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "not_equals", Value: "alex"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "NUL byte in an identifier value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "starts_with", Value: "a\x00b"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "NUL byte in an id value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "id", Operation: "contains", Value: "a\x00b"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "invalid UTF-8 in a filter value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "id", Operation: "equals", Value: "a\xffb"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string identifier value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "starts_with", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			// As a prefix it would select every user with an identifier.
			name: "empty identifier value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "identifier", Operation: "starts_with", Value: ""}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "team_id cannot be sorted by",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "team_id", Direction: "asc"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			// The storage option holds one team and filters are ANDed, so a
			// second value would silently win over the first.
			name: "team_id given twice is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters: []service.Filter{
					{Field: "team_id", Operation: "equals", Value: "team_1"},
					{Field: "team_id", Operation: "equals", Value: "team_2"},
				},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "schema_object_type cannot be sorted by",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Sorting:   &service.Sorting{Field: "schema_object_type", Direction: "asc"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "ordering operation on schema_object_type is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "schema_object_type", Operation: "less_than", Value: "consumer"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string schema_object_type value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "schema_object_type", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "not_contains on schema not implemented",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "schema", Operation: "not_contains", Value: "v1"}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name: "contains on team_id is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "team_id", Operation: "contains", Value: "team_"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string team_id value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "team_id", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unparseable created_at value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: "not-a-time"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string created_at value is invalid",
			input: service.ListUsersInput{
				ProjectID: "proj_1",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			// Validation fails before storage is reached, so no ListUsers
			// expectation is set and gomock would flag an unexpected call.
			svc, _ := newMockedUserService(t)

			out, err := svc.ListUsers(t.Context(), tc.input)
			require.ErrorIs(t, err, tc.wantErr)
			assert.Nil(t, out)
		})
	}
}

func TestUserService_ListUsers_TranslatesQuery(t *testing.T) {
	t.Parallel()

	t.Run("defaults to created_at desc with id as tiebreaker", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var got *database.ListOptions[domain.UserField]
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], _ service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				got = opts
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{ProjectID: "proj_1"})
		require.NoError(t, err)

		require.Equal(t, database.OrderDesc, got.Pagination.OrderBy.Direction)
		require.Len(t, got.Pagination.OrderBy.Columns, 2)
		assert.Equal(t, domain.UserFieldCreatedAt, got.Pagination.OrderBy.Columns[0].Field())
		assert.Equal(t, domain.UserFieldID, got.Pagination.OrderBy.Columns[1].Field())
	})

	t.Run("sorting overrides the default and keeps the id tiebreaker", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var got *database.ListOptions[domain.UserField]
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], _ service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				got = opts
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
			ProjectID: "proj_1",
			Sorting:   &service.Sorting{Field: "status", Direction: "asc"},
		})
		require.NoError(t, err)

		require.Equal(t, database.OrderAsc, got.Pagination.OrderBy.Direction)
		require.Len(t, got.Pagination.OrderBy.Columns, 2)
		assert.Equal(t, domain.UserFieldStatus, got.Pagination.OrderBy.Columns[0].Field())
		assert.Equal(t, domain.UserFieldID, got.Pagination.OrderBy.Columns[1].Field())
	})

	t.Run("every filter field maps and reaches storage", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.User]{}, nil)

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
			ProjectID: "proj_1",
			Filters: []service.Filter{
				{Field: "created_at", Operation: "greater_than", Value: time.Now().UTC().Format(time.RFC3339)},
				{Field: "id", Operation: "equals", Value: "usr_1"},
				{Field: "schema", Operation: "contains", Value: "sch_"},
				{Field: "schema_object_type", Operation: "equals", Value: "consumer"},
				{Field: "status", Operation: "equals", Value: "active"},
				{Field: "team_id", Operation: "equals", Value: "team_1"},
				{Field: "lifecycle_owner_team_id", Operation: "equals", Value: "team_2"},
			},
		})
		require.NoError(t, err)
	})

	// Membership is not a column on the user, so it must not become a
	// database.Filter — it reaches storage as the EXISTS option instead.
	t.Run("team_id reaches storage as a query option, not a filter", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var gotOpts service.UserQueryOptions
		var gotList *database.ListOptions[domain.UserField]
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], q service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				gotList = opts
				gotOpts = q
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
			ProjectID: "proj_1",
			Filters:   []service.Filter{{Field: "team_id", Operation: "equals", Value: "team_1"}},
		})
		require.NoError(t, err)

		require.NotNil(t, gotOpts.MembershipTeamID)
		assert.Equal(t, "team_1", *gotOpts.MembershipTeamID)
		// Only the implicit project predicate is left on the row filter.
		assert.NotNil(t, gotList.Filter)
	})

	t.Run("schema and object type filters compile to row filters", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var got *database.ListOptions[domain.UserField]
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], _ service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				got = opts
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
			ProjectID: "proj_1",
			Filters: []service.Filter{
				{Field: "schema_object_type", Operation: "contains", Value: "consum"},
				{Field: "schema_object_type", Operation: "not_equals", Value: "business"},
				{Field: "schema", Operation: "not_equals", Value: "https://example.test/consumer-v2.json"},
			},
		})
		require.NoError(t, err)

		objectType := database.Col(domain.UserFieldSchemaObjectType)
		assert.Equal(t, database.And(
			database.Equal(database.Col(domain.UserFieldProjectID), "proj_1"),
			database.StringContainsFold(objectType, "consum"),
			database.Not[domain.UserField](database.StringEqual(objectType, "business")),
			database.Not[domain.UserField](database.StringEqual(database.Col(domain.UserFieldSchemaURL), "https://example.test/consumer-v2.json")),
		), got.Filter)
	})

	t.Run("no membership filter leaves the query option unset", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var gotOpts service.UserQueryOptions
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, _ *database.ListOptions[domain.UserField], q service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				gotOpts = q
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{ProjectID: "proj_1"})
		require.NoError(t, err)

		assert.Nil(t, gotOpts.MembershipTeamID)
	})
}

// A patch that loses the race re-merges against the interleaved write
// (last-write-wins) instead of clobbering it: the stale statement result
// triggers a fresh read, and the second write carries the interleaved change.
func TestUserService_PatchUser_LastWriteWinsRetry(t *testing.T) {
	t.Parallel()

	const schemaJSON = `{
		"type": "object",
		"properties": {
			"email": {"type": "string"},
			"givenName": {"type": "string"}
		}
	}`
	firstRead := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	secondRead := firstRead.Add(time.Second)
	storedUser := func(updatedAt time.Time, email string) *domain.User {
		return &domain.User{
			ProjectID: "proj_1",
			SchemaURL: "https://example.test/schema.json",
			ID:        "user_1",
			Metadata:  domain.UserMetadata{UpdatedAt: updatedAt},
			Attributes: domain.Attributes{
				{Key: "email", Value: email},
				{Key: "givenName", Value: "Alice"},
			},
		}
	}

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, tx func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return tx(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(stmts).AnyTimes()
	stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.JSONSchema]{}, nil).AnyTimes()
	stmts.EXPECT().GetUserUniqueAttributeScopes(gomock.Any(), "proj_1", "user_1").
		Return(map[domain.AttributeKey]string{}, nil).AnyTimes()
	// The successful attempt emits user.updated (#877); the payload is asserted
	// in TestPatchUserAction_EventPayloadAttributeKeys, not here.
	stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	schemaStore := domainmock.NewMockJSONSchemaStore(ctrl)
	schemaStore.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/schema.json").
		Return(&domain.JSONSchema{
			ProjectID: "proj_1",
			URL:       "https://example.test/schema.json",
			Schema:    []byte(schemaJSON),
		}, nil).Times(2)

	gomock.InOrder(
		stmts.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(storedUser(firstRead, "alice@example.com"), nil),
		stmts.EXPECT().PatchUser(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, patch *domain.PatchUser) error {
				assert.Equal(t, firstRead, patch.ExpectedUpdatedAt)
				return database.NewNoRowFoundError(nil)
			},
		),
		// The retry reads the interleaved writer's state (a new email).
		stmts.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(storedUser(secondRead, "moved@example.com"), nil),
		stmts.EXPECT().PatchUser(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, patch *domain.PatchUser) error {
				assert.Equal(t, secondRead, patch.ExpectedUpdatedAt)
				email, ok := patch.Attributes.Get("email")
				require.True(t, ok)
				assert.Equal(t, "moved@example.com", email.Value, "the re-merge must keep the interleaved write")
				name, ok := patch.Attributes.Get("givenName")
				require.True(t, ok)
				assert.Equal(t, "Alicia", name.Value)
				return nil
			},
		),
		// Read-back for the response.
		stmts.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(storedUser(secondRead.Add(time.Second), "moved@example.com"), nil),
	)

	svcPool := service.NewPool(pool)
	svc := service.NewUserService(svcPool, schemaStore, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{})

	got, err := svc.PatchUser(t.Context(), service.PatchUserInput{
		ProjectID:  "proj_1",
		UserID:     "user_1",
		Attributes: map[string]any{"givenName": "Alicia"},
	})
	require.NoError(t, err)
	require.NotNil(t, got)
}

// When every retry loses the race, the caller gets a 409-mapped conflict,
// not the stale guard's row-not-found: a 404 would claim the user is gone
// while it demonstrably exists.
func TestUserService_PatchUser_ConflictAfterRetriesExhausted(t *testing.T) {
	t.Parallel()

	const schemaJSON = `{"type": "object", "properties": {"givenName": {"type": "string"}}}`

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, tx func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return tx(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(stmts).AnyTimes()

	schemaStore := domainmock.NewMockJSONSchemaStore(ctrl)
	schemaStore.EXPECT().GetJSONSchemaByID(gomock.Any(), gomock.Any(), "https://example.test/schema.json").
		Return(&domain.JSONSchema{URL: "https://example.test/schema.json", Schema: []byte(schemaJSON)}, nil).AnyTimes()
	stmts.EXPECT().GetUserUniqueAttributeScopes(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(map[domain.AttributeKey]string{}, nil).AnyTimes()

	stmts.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&domain.User{
			ProjectID:  "proj_1",
			SchemaURL:  "https://example.test/schema.json",
			ID:         "user_1",
			Attributes: domain.Attributes{{Key: "givenName", Value: "Alice"}},
		}, nil).Times(3)
	stmts.EXPECT().PatchUser(gomock.Any(), gomock.Any()).
		Return(database.NewNoRowFoundError(nil)).Times(3)

	svcPool := service.NewPool(pool)
	svc := service.NewUserService(svcPool, schemaStore, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{})

	_, err := svc.PatchUser(t.Context(), service.PatchUserInput{
		ProjectID:  "proj_1",
		UserID:     "user_1",
		Attributes: map[string]any{"givenName": "Alicia"},
	})
	require.ErrorIs(t, err, domain.ErrUserConflict())
}

func TestUserService_PatchUser_EmptyPatchRefused(t *testing.T) {
	t.Parallel()

	svc, _ := newMockedUserService(t)
	_, err := svc.PatchUser(t.Context(), service.PatchUserInput{ProjectID: "proj_1", UserID: "user_1"})
	require.ErrorIs(t, err, domain.ErrUserInvalid())
}

// A patch naming a schema of another objectType is refused before the write
// transaction opens, so the user keeps both its attributes and its schema.
func TestUserService_PatchUser_OtherLogicalSchemaRefused(t *testing.T) {
	t.Parallel()

	const schemaJSON = `{"type": "object", "properties": {"givenName": {"type": "string"}}}`

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	// No Transaction, PatchUser or InsertEvent expectation: reaching any of
	// them fails the test.

	stmts.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&domain.User{
			ProjectID:  "proj_1",
			SchemaURL:  "https://example.test/human.json",
			ID:         "user_1",
			Attributes: domain.Attributes{{Key: "givenName", Value: "Alice"}},
		}, nil)
	stmts.EXPECT().GetUserUniqueAttributeScopes(gomock.Any(), "proj_1", "user_1").
		Return(map[domain.AttributeKey]string{}, nil)

	schemaStore := domainmock.NewMockJSONSchemaStore(ctrl)
	schemaStore.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/human.json").
		Return(&domain.JSONSchema{
			ProjectID:  "proj_1",
			URL:        "https://example.test/human.json",
			ObjectType: new("human-user"),
			Schema:     []byte(schemaJSON),
		}, nil)
	schemaStore.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/machine.json").
		Return(&domain.JSONSchema{
			ProjectID:  "proj_1",
			URL:        "https://example.test/machine.json",
			ObjectType: new("machine-user"),
			Schema:     []byte(schemaJSON),
		}, nil)

	svcPool := service.NewPool(pool)
	svc := service.NewUserService(svcPool, schemaStore, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{})

	_, err := svc.PatchUser(t.Context(), service.PatchUserInput{
		ProjectID: "proj_1",
		UserID:    "user_1",
		SchemaURL: new("https://example.test/machine.json"),
	})
	require.ErrorIs(t, err, domain.ErrUserInvalid())
}

// The read is pinned to the caller's own record and the schema it points at:
// identity and project come from Self, never from the request.
func TestUserService_GetMyUserSchema(t *testing.T) {
	t.Parallel()

	svc, stmts := newMockedUserService(t)
	self, err := domain.SelfFromSession(&domain.Token{ProjectID: "proj_1", UserID: "user_1"}, time.Now())
	require.NoError(t, err)
	stmts.EXPECT().GetUser(gomock.Any(), database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), "proj_1"),
		database.Equal(database.Col(domain.UserFieldID), "user_1"),
	), gomock.Any()).Return(&domain.User{ProjectID: "proj_1", ID: "user_1", SchemaURL: "https://example.test/schema.json"}, nil)
	stmts.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.test/schema.json").
		Return(&domain.JSONSchema{ProjectID: "proj_1", URL: "https://example.test/schema.json"}, nil)

	schema, err := svc.GetMyUserSchema(t.Context(), service.GetMyUserInput{Self: self})
	require.NoError(t, err)
	assert.Equal(t, "https://example.test/schema.json", schema.URL)
}

func newMockedUserService(t *testing.T) (service.UserService, *servicemocks.MockAllStatements) {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	// Ref resolution lists the project's schemas on every read path; an empty
	// listing resolves every user to a bare id ref without further queries.
	stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.JSONSchema]{}, nil).AnyTimes()

	svcPool := service.NewPool(pool)
	return service.NewUserService(svcPool, nil, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{}), stmts
}

// An identifier lives under a different property per schema, and each revision's
// own designation governs its users, so the search has one arm per property,
// counted only for the users on the schemas that designate it.
func TestUserService_ListUsers_IdentifierFilter(t *testing.T) {
	t.Parallel()

	schemaCol := database.Col(domain.UserFieldSchemaURL)
	schema := func(url, identifier string) *domain.JSONSchema {
		return &domain.JSONSchema{URL: url, Schema: []byte(`{"x-identifier":"` + identifier + `"}`)}
	}

	t.Run("starts_with searches each designated property in the order of the search index", func(t *testing.T) {
		t.Parallel()

		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)
		stmts := servicemocks.NewMockAllStatements(ctrl)
		pool.EXPECT().Statements().Return(stmts).AnyTimes()
		// A caller allowed part of the project still needs every schema's
		// designation, but only the users its grants cover: the schema read
		// is unrestricted and the users read keeps the caller's filter.
		callerFilter := service.AuthzListFilter{ResourceKind: domain.ResourceKindUser}
		stmts.EXPECT().ListJSONSchemas(gomock.Cond(func(ctx context.Context) bool {
			return service.AuthzListUnrestricted(ctx)
		}), gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.JSONSchema]{Items: []*domain.JSONSchema{
				schema("https://example.test/a-v1", "email"),
				schema("https://example.test/a-v2", "email"),
				schema("https://example.test/b", "username"),
				{URL: "https://example.test/undesignated", Schema: []byte(`{}`)},
			}}, nil).AnyTimes()
		svcPool := service.NewPool(pool)
		svc := service.NewUserService(svcPool, nil, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{})

		var (
			got     *database.ListOptions[domain.UserField]
			gotOpts service.UserQueryOptions
		)
		stmts.EXPECT().
			ListUsers(gomock.Cond(func(ctx context.Context) bool {
				filter, ok := service.AuthzListFilterFromContext(ctx)
				return ok && filter.ResourceKind == callerFilter.ResourceKind
			}), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], queryOpts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				got, gotOpts = opts, queryOpts
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(service.WithAuthzListFilter(t.Context(), callerFilter), service.ListUsersInput{
			ProjectID: "proj_1",
			Filters:   []service.Filter{{Field: "identifier", Operation: "starts_with", Value: "Alex@Example.com"}},
		})
		require.NoError(t, err)
		assert.Equal(t, database.And[domain.UserField](database.Equal(database.Col(domain.UserFieldProjectID), "proj_1")), got.Filter)
		assert.Equal(t, v2user.SearchOrder(), got.Pagination.OrderBy)
		// The term is folded as the stored text is, so the two compare alike.
		assert.Equal(t, &service.UserSearch{
			ProjectID: "proj_1",
			Prefix:    "alex@example.com",
			Arms: []service.UserSearchArm{
				{Key: "email", Users: database.Or(database.Equal(schemaCol, "https://example.test/a-v1"), database.Equal(schemaCol, "https://example.test/a-v2"))},
				{Key: "username", Users: database.Or[domain.UserField](database.Equal(schemaCol, "https://example.test/b"))},
			},
		}, gotOpts.Search)
	})

	// The read still runs, carrying the page token storage validates.
	t.Run("no designating schema searches no property through the read", func(t *testing.T) {
		t.Parallel()

		svc, stmts := newMockedUserService(t)
		var (
			got     *database.ListOptions[domain.UserField]
			gotOpts service.UserQueryOptions
		)
		stmts.EXPECT().
			ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], queryOpts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				got, gotOpts = opts, queryOpts
				return &database.ListResult[*domain.User]{}, nil
			})

		_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
			ProjectID: "proj_1",
			PageToken: "token",
			Filters:   []service.Filter{{Field: "identifier", Operation: "starts_with", Value: "alex"}},
		})
		require.NoError(t, err)
		assert.Equal(t, &service.UserSearch{ProjectID: "proj_1", Prefix: "alex", Arms: []service.UserSearchArm{}}, gotOpts.Search)
		assert.Equal(t, []byte("token"), got.Pagination.Cursor)
	})

	// With no designation, what else the request asks for is still validated,
	// wherever the identifier filter stands.
	invalid := []struct {
		name  string
		input service.ListUsersInput
	}{
		{"unknown filter after", service.ListUsersInput{Filters: []service.Filter{
			{Field: "identifier", Operation: "starts_with", Value: "x"},
			{Field: "nope", Operation: "equals", Value: "bogus"},
		}}},
		{"unknown filter before", service.ListUsersInput{Filters: []service.Filter{
			{Field: "nope", Operation: "equals", Value: "bogus"},
			{Field: "identifier", Operation: "starts_with", Value: "x"},
		}}},
		{"unknown sort", service.ListUsersInput{
			Filters: []service.Filter{{Field: "identifier", Operation: "starts_with", Value: "x"}},
			Sorting: &service.Sorting{Field: "nope", Direction: "asc"},
		}},
	}
	for _, tc := range invalid {
		t.Run("no designating schema still refuses "+tc.name, func(t *testing.T) {
			t.Parallel()

			svc, _ := newMockedUserService(t)
			tc.input.ProjectID = "proj_1"
			_, err := svc.ListUsers(t.Context(), tc.input)
			require.ErrorIs(t, err, domain.ErrRequestInvalid())
		})
	}
}

// A `schema` equality on a built-in schema's `$id` must match the users
// stored under any of its bases, and an inequality must exclude all of them: a user created by naming one base is stored
// under the base the project holds the row at.
func TestUserService_ListUsers_SchemaFilterCoversEveryBuiltinBase(t *testing.T) {
	t.Parallel()

	bases := domain.NewBuiltinSchemaBases("https://schemas.test/builtin/v1", "https://schemas.test/builtin/v0")
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.JSONSchema]{}, nil).AnyTimes()
	svcPool := service.NewPool(pool)
	svc := service.NewUserService(svcPool, nil, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, bases)

	var gotList *database.ListOptions[domain.UserField]
	stmts.EXPECT().
		ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], _ service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
			gotList = opts
			return &database.ListResult[*domain.User]{}, nil
		}).Times(3)

	_, err := svc.ListUsers(t.Context(), service.ListUsersInput{
		ProjectID: "proj_1",
		Filters:   []service.Filter{{Field: "schema", Operation: "equals", Value: "https://schemas.test/builtin/v0/default-human-user.json"}},
	})
	require.NoError(t, err)

	and, ok := gotList.Filter.(database.AndFilter[domain.UserField])
	require.True(t, ok, "%T", gotList.Filter)
	require.Len(t, and.Filters, 2)
	or, ok := and.Filters[1].(database.OrFilter[domain.UserField])
	require.True(t, ok, "%T", and.Filters[1])
	var spellings []string
	for _, f := range or.Filters {
		s, ok := f.(*database.StringFilter[domain.UserField])
		require.True(t, ok, "%T", f)
		assert.Equal(t, domain.UserFieldSchemaURL, s.Column.Field())
		assert.Equal(t, database.StringMatchEqual, s.Match)
		spellings = append(spellings, s.Value)
	}
	assert.ElementsMatch(t, []string{
		"https://schemas.test/builtin/v0/default-human-user.json",
		"https://schemas.test/builtin/v1/default-human-user.json",
	}, spellings)

	// not_equals excludes the same spellings equals includes.
	_, err = svc.ListUsers(t.Context(), service.ListUsersInput{
		ProjectID: "proj_1",
		Filters:   []service.Filter{{Field: "schema", Operation: "not_equals", Value: "https://schemas.test/builtin/v0/default-human-user.json"}},
	})
	require.NoError(t, err)
	and, ok = gotList.Filter.(database.AndFilter[domain.UserField])
	require.True(t, ok, "%T", gotList.Filter)
	assert.Equal(t, database.Not[domain.UserField](or), and.Filters[1])

	// A schema outside the namespace, or a non-equality, is filtered as written.
	_, err = svc.ListUsers(t.Context(), service.ListUsersInput{
		ProjectID: "proj_1",
		Filters:   []service.Filter{{Field: "schema", Operation: "equals", Value: "sch_1"}},
	})
	require.NoError(t, err)
	and, ok = gotList.Filter.(database.AndFilter[domain.UserField])
	require.True(t, ok)
	_, ok = and.Filters[1].(*database.StringFilter[domain.UserField])
	assert.True(t, ok, "%T", and.Filters[1])
}

const takenAttributesSchema = `{
	"type": "object",
	"properties": {
		"email": {"type": "string", "x-unique": "project"},
		"username": {"type": "string", "x-unique": "team"},
		"givenName": {"type": "string"}
	}
}`

// newTakenAttributesFixture wires a user service whose write collides on a
// unique value. holders answers the unique claim probe per attribute key with the
// id of the user holding it; a key it does not name is free. A non-nil
// lookupErr fails the probe instead.
func newTakenAttributesFixture(t *testing.T, holders map[domain.AttributeKey]string, lookupErr error) (service.UserService, *servicemocks.MockAllStatements) {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, tx func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return tx(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(stmts).AnyTimes()
	stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	stmts.EXPECT().GetUserUniqueAttributeScopes(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(map[domain.AttributeKey]string{"username": "team_1"}, nil).AnyTimes()

	schemaStore := domainmock.NewMockJSONSchemaStore(ctrl)
	schemaStore.EXPECT().GetJSONSchemaByID(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&domain.JSONSchema{URL: "https://example.test/schema.json", Schema: []byte(takenAttributesSchema)}, nil).AnyTimes()

	stmts.EXPECT().GetUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.User{
		// The patch's read of the user it merges into.
		ProjectID:  "proj_1",
		SchemaURL:  "https://example.test/schema.json",
		ID:         "user_1",
		Attributes: domain.Attributes{{Key: "givenName", Value: "Alice"}},
	}, nil).AnyTimes()
	stmts.EXPECT().GetTakenUniqueAttributeKeys(gomock.Any(), "proj_1", gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, userID string, claims []service.UniqueAttributeClaim) ([]domain.AttributeKey, error) {
			if lookupErr != nil {
				return nil, lookupErr
			}
			// Each unique attribute of the write is one claim under its
			// unique team scope.
			var taken []domain.AttributeKey
			for _, c := range claims {
				if c.Key == "username" {
					assert.Equal(t, "team_1", c.TeamID)
				} else {
					assert.Empty(t, c.TeamID)
				}
				if holder, ok := holders[c.Key]; ok && holder != userID {
					taken = append(taken, c.Key)
				}
			}
			return taken, nil
		},
	).AnyTimes()

	svcPool := service.NewPool(pool)
	return service.NewUserService(svcPool, schemaStore, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{}), stmts
}

// A dry run answers what the patch would answer and stops before the
// transaction: the fixture holds no PatchUser, so a write fails the test, and
// the event is emitted only inside that transaction.
func TestUserService_PatchUserDryRun(t *testing.T) {
	t.Parallel()

	t.Run("a valid patch answers the user it would leave", func(t *testing.T) {
		t.Parallel()
		svc, stmts := newTakenAttributesFixture(t, nil, nil)
		stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.JSONSchema]{}, nil)

		user, err := svc.PatchUser(t.Context(), service.PatchUserInput{
			ProjectID:  "proj_1",
			UserID:     "user_1",
			Attributes: map[string]any{"email": "alice@example.com"},
			DryRun:     true,
		})
		require.NoError(t, err)
		assert.Equal(t, "user_1", user.ID)
		assert.Equal(t, "https://example.test/schema.json", user.SchemaURL)
		attributes, err := user.Attributes.ToMap()
		require.NoError(t, err)
		assert.Equal(t, map[string]any{"email": "alice@example.com", "givenName": "Alice"}, attributes)
	})

	t.Run("an invalid patch answers the real refusal", func(t *testing.T) {
		t.Parallel()
		svc, _ := newTakenAttributesFixture(t, nil, nil)

		_, err := svc.PatchUser(t.Context(), service.PatchUserInput{
			ProjectID:  "proj_1",
			UserID:     "user_1",
			Attributes: map[string]any{"email": 5},
			DryRun:     true,
		})
		require.ErrorIs(t, err, domain.ErrUserAttributesInvalid(nil))
		var derr domain.Error
		require.ErrorAs(t, err, &derr)
		assert.Equal(t, domain.UserAttributesDetails{Keys: []domain.AttributeKey{"email"}}, derr.Details)
	})

	t.Run("a value another user holds now answers the conflict", func(t *testing.T) {
		t.Parallel()
		svc, _ := newTakenAttributesFixture(t, map[domain.AttributeKey]string{
			"email":    "user_1", // the user's own claim
			"username": "user_2",
		}, nil)

		_, err := svc.PatchUser(t.Context(), service.PatchUserInput{
			ProjectID:  "proj_1",
			UserID:     "user_1",
			Attributes: map[string]any{"email": "alice@example.com", "username": "taken"},
			DryRun:     true,
		})
		requireTakenFields(t, err, "username")
	})

	t.Run("a failed lookup is a server fault, not a yes", func(t *testing.T) {
		t.Parallel()
		svc, _ := newTakenAttributesFixture(t, nil, errors.New("database down"))

		_, err := svc.PatchUser(t.Context(), service.PatchUserInput{
			ProjectID:  "proj_1",
			UserID:     "user_1",
			Attributes: map[string]any{"email": "alice@example.com"},
			DryRun:     true,
		})
		require.ErrorIs(t, err, domain.ErrInternal(nil))
	})
}

func requireTakenFields(t *testing.T, err error, keys ...domain.AttributeKey) {
	t.Helper()
	require.ErrorIs(t, err, domain.ErrUserAlreadyExists())
	var derr domain.Error
	require.ErrorAs(t, err, &derr)
	if len(keys) == 0 {
		assert.Nil(t, derr.Details)
		return
	}
	assert.Equal(t, domain.UserAttributesDetails{Keys: keys}, derr.Details)
}

// A uniqueness conflict names the attribute whose value is taken, not the
// user who holds it. A unique value the user being written holds itself, and
// a non-unique attribute, are not named.
func TestUserService_UniquenessConflictNamesTheAttribute(t *testing.T) {
	t.Parallel()
	unique := database.NewUniqueError("zitadel_nextgen.user_attributes", "idx_user_attributes_unique", nil)

	t.Run("create", func(t *testing.T) {
		t.Parallel()
		svc, stmts := newTakenAttributesFixture(t, map[domain.AttributeKey]string{"email": "user_2"}, nil)
		stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).Return(unique)

		_, err := svc.CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  "proj_1",
			TeamID:     new("team_1"),
			SchemaURL:  "https://example.test/schema.json",
			Attributes: map[string]any{"email": "taken@example.com", "username": "alice", "givenName": "Alice"},
		})
		requireTakenFields(t, err, "email")
	})

	t.Run("patch", func(t *testing.T) {
		t.Parallel()
		svc, stmts := newTakenAttributesFixture(t, map[domain.AttributeKey]string{
			"email":    "user_1", // the user's own claim
			"username": "user_2",
		}, nil)
		stmts.EXPECT().PatchUser(gomock.Any(), gomock.Any()).Return(unique)

		_, err := svc.PatchUser(t.Context(), service.PatchUserInput{
			ProjectID:  "proj_1",
			UserID:     "user_1",
			Attributes: map[string]any{"email": "alice@example.com", "username": "taken"},
		})
		requireTakenFields(t, err, "username")
	})

	t.Run("a value freed since stays unnamed", func(t *testing.T) {
		t.Parallel()
		svc, stmts := newTakenAttributesFixture(t, nil, nil)
		stmts.EXPECT().PatchUser(gomock.Any(), gomock.Any()).Return(unique)

		_, err := svc.PatchUser(t.Context(), service.PatchUserInput{
			ProjectID:  "proj_1",
			UserID:     "user_1",
			Attributes: map[string]any{"email": "alice@example.com"},
		})
		requireTakenFields(t, err)
	})

	t.Run("a failed lookup stays unnamed", func(t *testing.T) {
		t.Parallel()
		svc, stmts := newTakenAttributesFixture(t, nil, database.NewUnavailableError(nil))
		stmts.EXPECT().CreateUser(gomock.Any(), gomock.Any()).Return(unique)

		_, err := svc.CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  "proj_1",
			SchemaURL:  "https://example.test/schema.json",
			Attributes: map[string]any{"email": "taken@example.com"},
		})
		requireTakenFields(t, err)
	})
}

func TestDeleteUserAction_RevokesTheUsersGrants(t *testing.T) {
	t.Parallel()

	t.Run("a deleted user loses every grant, each with its own event", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		stmts := servicemocks.NewMockAllStatements(ctrl)
		var events []*domain.Event
		stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, ev *domain.Event) error {
				events = append(events, ev)
				return nil
			},
		).AnyTimes()
		gomock.InOrder(
			stmts.EXPECT().UserExists(gomock.Any(), "proj_platform", "user_1").Return(true, nil),
			stmts.EXPECT().ListProjectsOwnedThroughMember(gomock.Any(), "user_1"),
			stmts.EXPECT().DeleteUserByID(gomock.Any(), "proj_platform", "user_1"),
			stmts.EXPECT().RevokeAuthzAssignmentsByPrincipal(gomock.Any(), domain.AuthzPrincipalTypeUser, "user_1").
				Return([]*domain.AuthzAssignment{
					{ID: "asgn_a", ProjectID: "proj_a", PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "user_1", Relation: "admin"},
					{ID: "asgn_b", ProjectID: "proj_b", PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "user_1", Relation: "viewer"},
				}, nil),
		)

		err := service.NewDeleteUserAction(service.DeleteUserInput{ProjectID: "proj_platform", UserID: "user_1"}).
			Apply(t.Context(), stmts)
		require.NoError(t, err)

		require.Len(t, events, 3)
		for i, want := range []struct{ project, entity, relation string }{
			{"proj_a", "asgn_a", "admin"},
			{"proj_b", "asgn_b", "viewer"},
		} {
			assert.Equal(t, domain.EventTypeAuthzRevoked, events[i].EventType)
			assert.Equal(t, want.project, events[i].ProjectID)
			require.NotNil(t, events[i].EntityID)
			assert.Equal(t, want.entity, *events[i].EntityID)
			var payload domain.AuthzRevokedPayload
			require.NoError(t, json.Unmarshal(events[i].Payload, &payload))
			assert.Equal(t, domain.AuthzRevokedPayload{PrincipalType: "user", PrincipalID: "user_1", Relation: want.relation}, payload)
		}
		assert.Equal(t, domain.EventTypeUserDeleted, events[2].EventType)
	})

	// The revoke is keyed on the user alone, so a delete that matched no user
	// in the caller's project must not reach a same-id user's grants elsewhere.
	t.Run("a user outside the project keeps their grants", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		stmts := servicemocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().UserExists(gomock.Any(), "proj_other", "user_1").Return(false, nil)
		stmts.EXPECT().DeleteUserByID(gomock.Any(), "proj_other", "user_1").Return(database.NewNoRowFoundError(nil))

		err := service.NewDeleteUserAction(service.DeleteUserInput{ProjectID: "proj_other", UserID: "user_1"}).
			Apply(t.Context(), stmts)
		require.NoError(t, err)
	})
}
