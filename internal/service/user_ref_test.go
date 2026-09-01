package service_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
)

func TestStatementsUserRefResolver_ResolveUserRefs(t *testing.T) {
	newResolver := func(t *testing.T, stmts *mocks.MockAllStatements) service.StatementsUserRefResolver {
		t.Helper()
		ctrl := gomock.NewController(t)
		pool := mocks.NewMockPool(ctrl)
		pool.EXPECT().Statements().Return(stmts).AnyTimes()
		return service.StatementsUserRefResolver{Pool: service.NewPool(pool)}
	}

	userSchema := func(schemaURL, document string) *domain.JSONSchema {
		return &domain.JSONSchema{
			ProjectID: "proj",
			URL:       schemaURL,
			Kind:      domain.JSONSchemaKindUserSchema,
			Schema:    []byte(document),
		}
	}

	expectSchemas := func(stmts *mocks.MockAllStatements, schemas ...*domain.JSONSchema) {
		stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.JSONSchema]{Items: schemas}, nil)
	}

	t.Run("resolves a mixed-schema page with one batched query", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		expectSchemas(stmts,
			userSchema("https://s/human", `{"x-identifier":"email","x-display":["givenName","familyName"]}`),
			userSchema("https://s/admin", `{"x-identifier":"username"}`),
		)
		var gotKeys []string
		stmts.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, _ *database.ListOptions[domain.UserField], opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				gotKeys = opts.AttributeKeys
				return &database.ListResult[*domain.User]{Items: []*domain.User{
					{ProjectID: "proj", SchemaURL: "https://s/human", ID: "user-1", Attributes: domain.AttributesFromMap(map[string]any{
						"email": "ada@example.com", "givenName": "Ada", "familyName": "Lovelace",
					})},
					{ProjectID: "proj", SchemaURL: "https://s/admin", ID: "user-2", Attributes: domain.AttributesFromMap(map[string]any{
						"username": "root",
					})},
				}}, nil
			})

		refs, err := newResolver(t, stmts).ResolveUserRefs(t.Context(), "proj", []string{"user-2", "user-1", "user-2"})

		require.NoError(t, err)
		assert.Equal(t, map[string]domain.UserRef{
			"user-1": {UserID: "user-1", Identifier: "ada@example.com", IdentifierProperty: "email", Display: "Ada Lovelace"},
			"user-2": {UserID: "user-2", Identifier: "root", IdentifierProperty: "username"},
		}, refs)
		assert.ElementsMatch(t, []string{"email", "givenName", "familyName", "username"}, gotKeys,
			"hydration must be limited to the union of designated keys")
	})

	t.Run("missing users are absent from the result", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		expectSchemas(stmts, userSchema("https://s/human", `{"x-identifier":"email"}`))
		stmts.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.User]{Items: []*domain.User{
				{ProjectID: "proj", SchemaURL: "https://s/human", ID: "user-1", Attributes: domain.AttributesFromMap(map[string]any{"email": "a@example.com"})},
			}}, nil)

		refs, err := newResolver(t, stmts).ResolveUserRefs(t.Context(), "proj", []string{"user-1", "user-gone"})

		require.NoError(t, err)
		assert.Len(t, refs, 1)
		assert.NotContains(t, refs, "user-gone")
	})

	t.Run("user of an unstored schema resolves to a bare ref", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		expectSchemas(stmts, userSchema("https://s/human", `{"x-identifier":"email"}`))
		stmts.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.User]{Items: []*domain.User{
				{ProjectID: "proj", SchemaURL: "https://s/builtin", ID: "user-3", Attributes: domain.AttributesFromMap(map[string]any{"email": "b@example.com"})},
			}}, nil)

		refs, err := newResolver(t, stmts).ResolveUserRefs(t.Context(), "proj", []string{"user-3"})

		require.NoError(t, err)
		assert.Equal(t, domain.UserRef{UserID: "user-3"}, refs["user-3"])
	})

	t.Run("no designations anywhere hydrates no attribute rows", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)
		expectSchemas(stmts, userSchema("https://s/passkey", `{"type":"object"}`))
		var gotKeys []string
		stmts.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, _ *database.ListOptions[domain.UserField], opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
				gotKeys = opts.AttributeKeys
				return &database.ListResult[*domain.User]{Items: []*domain.User{
					{ProjectID: "proj", SchemaURL: "https://s/passkey", ID: "user-4"},
				}}, nil
			})

		refs, err := newResolver(t, stmts).ResolveUserRefs(t.Context(), "proj", []string{"user-4"})

		require.NoError(t, err)
		assert.Equal(t, domain.UserRef{UserID: "user-4"}, refs["user-4"])
		assert.Equal(t, []string{""}, gotKeys,
			"nil would hydrate everything; the sentinel key hydrates nothing")
	})

	t.Run("empty id set short-circuits without queries", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAllStatements(ctrl)

		refs, err := newResolver(t, stmts).ResolveUserRefs(t.Context(), "proj", nil)

		require.NoError(t, err)
		assert.Empty(t, refs)
	})
}
