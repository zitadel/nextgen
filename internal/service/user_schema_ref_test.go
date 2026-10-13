package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

func TestSchemaService_ResolveUserSchema(t *testing.T) {
	unparsed := &domain.JSONSchema{ProjectID: "proj", URL: "https://example.com/fetched.json"}

	tests := []struct {
		name    string
		ref     string
		wantURL string
		wantErr error
	}{
		{name: "objectType", ref: "human-user", wantURL: testUserSchema.URL},
		{name: "$id URL", ref: testUserSchema.URL, wantURL: testUserSchema.URL},
		{name: "minted id", ref: testMachineSchema.URL, wantURL: testMachineSchema.URL},
		{name: "unknown objectType", ref: "visitor", wantErr: domain.ErrJSONSchemaNotFound()},
		{name: "unknown id", ref: "sch_unknown", wantErr: domain.ErrJSONSchemaNotFound()},
		{name: "schema declaring no objectType", ref: unparsed.URL, wantErr: domain.ErrJSONSchemaNotFound()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stmts := servicemocks.NewMockAllStatements(gomock.NewController(t))
			stubUserSchemas(stmts, testUserSchema, testMachineSchema, unparsed)
			svc := service.NewSchemaService(v2PoolFromStatements(t, stmts), nil, nil)

			schema, err := svc.ResolveUserSchema(t.Context(), "proj", tt.ref)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantURL, schema.URL)
		})
	}
}
