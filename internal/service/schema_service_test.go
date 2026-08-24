package service_test

import (
	"context"
	"errors"
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
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewSchemaService(service.NewPool(pool), nil, nil), statements
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
	return &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.JSONSchemaField]{
			Limit:  limit,
			Cursor: []byte(cursor),
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
		name         string
		input        service.ListSchemasInput
		wantOpts     *database.ListOptions[domain.JSONSchemaField]
		result       *database.ListResult[*domain.JSONSchema]
		statementErr error
		wantErr      error
		checkOut     func(t *testing.T, out *service.ListSchemasOutput)
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
				assert.Equal(t, "next", out.NextPageToken)
			},
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
				Kind:      ptr(domain.JSONSchemaKindUserSchema),
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
			input:    service.ListSchemasInput{ProjectID: "proj_a", PageToken: "tok"},
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
			input:        service.ListSchemasInput{ProjectID: "proj_a", PageToken: "bad"},
			wantOpts:     listSchemasOpts(20, "bad"),
			statementErr: database.ErrInvalidCursor(),
			wantErr:      domain.ErrRequestInvalid(),
		},
		{
			name:         "cursor order mismatch maps to request invalid",
			input:        service.ListSchemasInput{ProjectID: "proj_a", PageToken: "bad"},
			wantOpts:     listSchemasOpts(20, "bad"),
			statementErr: database.ErrCursorOrderMismatch(),
			wantErr:      domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, statements := newMockedSchemaService(t)
			statements.EXPECT().
				ListJSONSchemas(gomock.Any(), tc.wantOpts).
				Return(tc.result, tc.statementErr)

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
