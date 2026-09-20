package service_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"go.uber.org/mock/gomock"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedSchemaService(t *testing.T) (*service.SchemaService, *servicemocks.MockAllStatements) {
	t.Helper()
	svc, statements, _ := newMockedSchemaServiceWithPool(t, nil)
	return svc, statements
}

func newMockedSchemaServiceWithPool(
	t *testing.T,
	validator *domain.SchemaValidator,
) (*service.SchemaService, *servicemocks.MockAllStatements, *servicemocks.MockStatementPool) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewSchemaService(service.NewPool(pool), nil, validator), statements, pool
}

const conflictSchemaBase = "https://schemas.example.com/schemas"

func conflictSchemaDocument(schemaID string) []byte {
	return fmt.Appendf(nil, `{
      "$id": %q,
      "title": "conflict",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "objectType": "conflict-user",
      "metaSchema": "%s/user-schema.json",
      "kind": "user-schema",
      "type": "object",
      "x-auth-methods": { "passkey": { "enabled": true } },
      "properties": { "givenName": { "type": "string" } }
    }`, schemaID, conflictSchemaBase)
}

// A unique violation on json_schemas can come from either of the table's two
// unique constraints, and only Postgres says which. CreateSchema reads the URL
// back to tell them apart, so the two answers hang on what that read finds.
func TestSchemaService_CreateSchemaUniqueViolation(t *testing.T) {
	t.Parallel()

	const schemaID = conflictSchemaBase + "/conflict-user.json"

	tests := []struct {
		name    string
		found   *domain.JSONSchema
		findErr error
		wantErr domain.Error
	}{
		{
			name:    "url is taken",
			found:   &domain.JSONSchema{URL: schemaID},
			wantErr: domain.ErrJSONSchemaAlreadyExists(),
		},
		{
			name:    "url is free, so the revision lost the timestamp",
			findErr: database.NewNoRowFoundError(errors.New("no rows")),
			wantErr: domain.ErrJSONSchemaRevisionConflict(),
		},
		{
			// An inconclusive read must not invent the narrower answer.
			name:    "read back fails",
			findErr: errors.New("boom"),
			wantErr: domain.ErrJSONSchemaAlreadyExists(),
		},
	}

	validator, err := domain.NewSchemaValidator(conflictSchemaBase)
	require.NoError(t, err)

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, statements, pool := newMockedSchemaServiceWithPool(t, validator)
			pool.EXPECT().
				Transaction(gomock.Any(), gomock.Any()).
				Return(database.NewUniqueError("json_schemas", "", errors.New("duplicate key")))
			statements.EXPECT().
				GetJSONSchemaByID(gomock.Any(), "proj_a", schemaID).
				Return(tc.found, tc.findErr)

			_, err := svc.CreateSchema(context.Background(), service.CreateSchemaInput{
				ProjectID: "proj_a",
				Schema:    conflictSchemaDocument(schemaID),
			})
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}

// listSchemasOpts builds the full statement input the service is expected to
// produce for project "proj_a". Passing it to EXPECT (rather than gomock.Any
// plus per-field assertions) makes every case validate every field: a wrong
// filter, ordering, limit or cursor fails the mock match.
func listSchemasOpts(
	limit uint32,
	cursor string,
	extraFilters ...database.Filter[domain.JSONSchemaField],
) *database.ListOptions[domain.JSONSchemaField] {
	filters := append([]database.Filter[domain.JSONSchemaField]{
		database.Equal(database.Col(domain.JSONSchemaFieldProjectID), "proj_a"),
	}, extraFilters...)
	// No page token means no cursor at all, not an empty one — the two are
	// different values to the matcher.
	var cursorBytes []byte
	if cursor != "" {
		cursorBytes = []byte(cursor)
	}
	return &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.JSONSchemaField]{
			Limit:  limit,
			Cursor: cursorBytes,
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns: []database.Column[domain.JSONSchemaField]{
					database.Col(domain.JSONSchemaFieldCreatedAt),
					database.Col(domain.JSONSchemaFieldURL),
				},
				Direction: database.OrderDesc,
			},
		},
	}
}

func TestSchemaService_ListSchemas(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		input         service.ListSchemasInput
		wantOpts      *database.ListOptions[domain.JSONSchemaField]
		wantQueryOpts service.JSONSchemaQueryOptions
		result        *database.ListResult[*domain.JSONSchema]
		statementErr  error
		// wantNoCall marks a case rejected before the statement is reached.
		wantNoCall bool
		wantErr    error
		checkOut   func(t *testing.T, out *service.ListSchemasOutput)
	}{
		{
			name:     "defaults to newest first with url tiebreaker",
			input:    service.ListSchemasInput{ProjectID: "proj_a"},
			wantOpts: listSchemasOpts(20, ""),
			result: &database.ListResult[*domain.JSONSchema]{
				Items:      []*domain.JSONSchema{{URL: "sch_b"}, {URL: "sch_a"}},
				NextCursor: []byte("next"),
			},
			checkOut: func(t *testing.T, out *service.ListSchemasOutput) {
				assert.Len(t, out.Items, 2)
				assert.Equal(t, "all.next", out.NextPageToken)
			},
		},
		{
			name: "latest mode reaches the statement and stamps its own token",
			input: service.ListSchemasInput{
				ProjectID:                   "proj_a",
				LatestRevisionPerObjectType: true,
			},
			wantOpts:      listSchemasOpts(20, ""),
			wantQueryOpts: service.JSONSchemaQueryOptions{LatestRevisionPerObjectType: true},
			result: &database.ListResult[*domain.JSONSchema]{
				Items:      []*domain.JSONSchema{{URL: "sch_b"}},
				NextCursor: []byte("next"),
			},
			checkOut: func(t *testing.T, out *service.ListSchemasOutput) {
				assert.Equal(t, "latest.next", out.NextPageToken)
			},
		},
		{
			name: "latest mode page token is unwrapped into the cursor",
			input: service.ListSchemasInput{
				ProjectID:                   "proj_a",
				LatestRevisionPerObjectType: true,
				PageToken:                   "latest.tok",
			},
			wantOpts:      listSchemasOpts(20, "tok"),
			wantQueryOpts: service.JSONSchemaQueryOptions{LatestRevisionPerObjectType: true},
			result:        &database.ListResult[*domain.JSONSchema]{},
		},
		{
			// Both modes sort identically, so nothing downstream would notice the
			// swap: the token has to be refused here or the caller silently gets
			// a page of a row set they did not ask for.
			name: "token from the other mode is rejected",
			input: service.ListSchemasInput{
				ProjectID:                   "proj_a",
				LatestRevisionPerObjectType: true,
				PageToken:                   "all.tok",
			},
			wantNoCall: true,
			wantErr:    domain.ErrRequestInvalid(),
		},
		{
			name:       "unstamped page token is rejected",
			input:      service.ListSchemasInput{ProjectID: "proj_a", PageToken: "tok"},
			wantNoCall: true,
			wantErr:    domain.ErrRequestInvalid(),
		},
		{
			name:  "object type filter applied",
			input: service.ListSchemasInput{ProjectID: "proj_a", ObjectType: "human-user"},
			wantOpts: listSchemasOpts(20, "",
				database.Equal(database.Col(domain.JSONSchemaFieldObjectType), "human-user"),
			),
			result: &database.ListResult[*domain.JSONSchema]{},
		},
		{
			name: "kind filter applied",
			input: service.ListSchemasInput{
				ProjectID: "proj_a",
				Kind:      new(domain.JSONSchemaKindUserSchema),
			},
			wantOpts: listSchemasOpts(20, "",
				database.Equal(database.Col(domain.JSONSchemaFieldKind), domain.JSONSchemaKindUserSchema.String()),
			),
			result: &database.ListResult[*domain.JSONSchema]{},
		},
		{
			name:     "limit clamped to max",
			input:    service.ListSchemasInput{ProjectID: "proj_a", Limit: 500},
			wantOpts: listSchemasOpts(100, ""),
			result:   &database.ListResult[*domain.JSONSchema]{},
		},
		{
			name:     "page token passed through as cursor",
			input:    service.ListSchemasInput{ProjectID: "proj_a", PageToken: "all.tok"},
			wantOpts: listSchemasOpts(20, "tok"),
			result:   &database.ListResult[*domain.JSONSchema]{},
		},
		{
			name:     "last page returns no token",
			input:    service.ListSchemasInput{ProjectID: "proj_a"},
			wantOpts: listSchemasOpts(20, ""),
			result: &database.ListResult[*domain.JSONSchema]{
				Items: []*domain.JSONSchema{{URL: "sch_a"}},
			},
			checkOut: func(t *testing.T, out *service.ListSchemasOutput) {
				assert.Empty(t, out.NextPageToken)
			},
		},
		{
			name:         "statement error is wrapped",
			input:        service.ListSchemasInput{ProjectID: "proj_a"},
			wantOpts:     listSchemasOpts(20, ""),
			statementErr: errors.New("boom"),
			wantErr:      domain.ErrInternal(nil),
		},
		{
			name:         "invalid cursor maps to request invalid",
			input:        service.ListSchemasInput{ProjectID: "proj_a", PageToken: "all.bad"},
			wantOpts:     listSchemasOpts(20, "bad"),
			statementErr: database.ErrInvalidCursor(),
			wantErr:      domain.ErrRequestInvalid(),
		},
		{
			name:         "cursor order mismatch maps to request invalid",
			input:        service.ListSchemasInput{ProjectID: "proj_a", PageToken: "all.bad"},
			wantOpts:     listSchemasOpts(20, "bad"),
			statementErr: database.ErrCursorOrderMismatch(),
			wantErr:      domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, statements := newMockedSchemaService(t)
			if !tc.wantNoCall {
				statements.EXPECT().
					ListJSONSchemas(gomock.Any(), tc.wantOpts, tc.wantQueryOpts).
					Return(tc.result, tc.statementErr)
			}

			out, err := svc.ListSchemas(context.Background(), tc.input)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			if tc.checkOut != nil {
				tc.checkOut(t, out)
			}
		})
	}
}
