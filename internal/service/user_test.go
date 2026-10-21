package service_test

import (
	"context"
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
	svc := service.NewUserService(svcPool, schemaStore, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{})

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
	svc := service.NewUserService(svcPool, schemaStore, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{})

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
	svc := service.NewUserService(svcPool, schemaStore, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{})

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
	return service.NewUserService(svcPool, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{}), stmts
}

// A `schema` equality on a built-in schema's `$id` must match the users
// stored under any of its bases: a user created by naming one base is stored
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
	svc := service.NewUserService(svcPool, nil, nil, service.StatementsUserRefResolver{Pool: svcPool}, bases)

	var gotList *database.ListOptions[domain.UserField]
	stmts.EXPECT().
		ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.UserField], _ service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
			gotList = opts
			return &database.ListResult[*domain.User]{}, nil
		}).Times(2)

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
// unique value. holders answers the registry probe per attribute key with the
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
			// registry team scope.
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
	return service.NewUserService(svcPool, schemaStore, nil, service.StatementsUserRefResolver{Pool: svcPool}, domain.BuiltinSchemaBases{}), stmts
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
	unique := database.NewUniqueError("zitadel_nextgen.user_unique_attributes", "pk", nil)

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
