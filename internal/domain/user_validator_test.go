package domain_test

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
)

//go:embed testdata/user-meta.schema.json
var testMetaSchema []byte

//go:embed testdata/valid-tenant-user.schema.json
var validTenantUserSchema []byte

func TestValidateUserInstance(t *testing.T) {
	const instanceID = "instance-id"
	const schemaURL = "https://example.com/schemas/valid-tenant-user.schema.json"

	tests := []struct {
		name        string
		payload     *domain.UserInstancePayload
		wantErrors  map[string]string
		wantErrType func(error) bool
	}{
		{
			name: "valid user instance",
			payload: &domain.UserInstancePayload{
				InstanceID: instanceID,
				SchemaURL:  schemaURL,
				Payload:    json.RawMessage(`{"email":"alice@example.com","given_name":"Alice","family_name":"Smith"}`),
			},
			wantErrors:  map[string]string{},
			wantErrType: nil,
		},
		{
			name: "invalid user instance -  missing required fields",
			payload: &domain.UserInstancePayload{
				InstanceID: instanceID,
				SchemaURL:  schemaURL,
				Payload:    json.RawMessage(`{"family_name":"Smith"}`),
			},
			wantErrors: map[string]string{
				"/required/email":      `missing required field "email"`,
				"/required/given_name": `missing required field "given_name"`,
			},
			wantErrType: func(err error) bool {
				return errors.As(err, new(*types.ValidationErrors))
			},
		},
		{
			name: "invalid user instance -  invalid type",
			payload: &domain.UserInstancePayload{
				InstanceID: instanceID,
				SchemaURL:  schemaURL,
				Payload:    json.RawMessage(`{"email":12345, "given_name":"Alice", "family_name":"Smith"}`),
			},
			wantErrors: map[string]string{
				"/properties/email": `instance has type "integer", want "string"`,
			},
			wantErrType: func(err error) bool {
				return errors.As(err, new(*types.ValidationError))
			},
		},
		{
			name: "given_name too short",
			payload: &domain.UserInstancePayload{
				InstanceID: instanceID,
				SchemaURL:  schemaURL,
				Payload:    json.RawMessage(`{"email":"alice@example.com","given_name":"","family_name":"Smith"}`),
			},
			wantErrors: map[string]string{
				"/properties/given_name": `value "" too short for "minLength" argument 1`,
			},
			wantErrType: func(err error) bool {
				return errors.As(err, new(*types.ValidationError))
			},
		},
		{
			name: "given_name too long",
			payload: &domain.UserInstancePayload{
				InstanceID: instanceID,
				SchemaURL:  schemaURL,
				Payload:    json.RawMessage(`{"email":"alice@example.com","given_name":"` + strings.Repeat("A", 101) + `","family_name":"Smith"}`),
			},
			wantErrors: map[string]string{
				"/properties/given_name": `value "` + strings.Repeat("A", 101) + `" too long for "maxLength" argument 100`,
			},
			wantErrType: func(err error) bool {
				return errors.As(err, new(*types.ValidationError))
			},
		},
		{
			name: "zip pattern violation",
			payload: &domain.UserInstancePayload{
				InstanceID: instanceID,
				SchemaURL:  schemaURL,
				Payload:    json.RawMessage(`{"email":"alice@example.com","given_name":"Alice","family_name":"Smith","address":{"zip":"ABC"}}`),
			},
			wantErrors: map[string]string{
				"/properties/address/properties/zip": `"pattern" regexp "^[0-9]{4,10}$" did not match "ABC"`,
			},
			wantErrType: func(err error) bool {
				return errors.As(err, new(*types.ValidationError))
			},
		},
		{
			name: "address wrong type",
			payload: &domain.UserInstancePayload{
				InstanceID: instanceID,
				SchemaURL:  schemaURL,
				Payload:    json.RawMessage(`{"email":"alice@example.com","given_name":"Alice","family_name":"Smith","address":"flat 1"}`),
			},
			wantErrors: map[string]string{
				"/properties/address": `instance has type "string", want "object"`,
			},
			wantErrType: func(err error) bool {
				return errors.As(err, new(*types.ValidationError))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Build the meta-schema (used by the resolver to validate fetched schemas).
			var raw any
			require.NoError(t, json.Unmarshal(testMetaSchema, &raw))
			metaSchema, err := jsonschema.SchemaFromJSON("", nil, raw)
			require.NoError(t, err)

			// The tenant schema returned by the resolver will always be valid,
			// as the tenant schema is validated before being persisted.
			var def struct {
				Schema json.RawMessage `json:"schema"`
			}
			require.NoError(t, json.Unmarshal(validTenantUserSchema, &def))
			tenantSchema := mustJSONSchema(t, string(def.Schema))

			ctrl := gomock.NewController(t)
			mockRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			expectResolve(mockRepo, instanceID, schemaURL, &domain.JSONSchema{Schema: tenantSchema}, nil)

			resolver, err := domain.NewJSONSchemaResolver(mockRepo, 128, metaSchema)
			require.NoError(t, err)

			validator := domain.NewTenantUserInstanceValidator(resolver)
			err = validator.ValidateUserInstance(context.Background(), nil, tt.payload)
			if tt.wantErrType == nil {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
				assert.True(t, tt.wantErrType(err))
				assert.Equal(t, tt.wantErrors, flattenInstanceErrors(err))
			}
		})
	}
}

// expectResolve registers the two mock calls that every resolver.Resolve triggers.
func expectResolve(mockRepo *domainmock.MockJSONSchemaRepository, instanceID, schemaURL string, result *domain.JSONSchema, resolveErr error) {
	mockRepo.EXPECT().PrimaryKeyCondition(instanceID, schemaURL).Return(pkCond)
	mockRepo.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(result, resolveErr)
}

// flattenInstanceErrors collects validation errors into a loc → msg map.
// loc is built from the Loc path segments joined with "/", e.g. "/required/email".
func flattenInstanceErrors(err error) map[string]string {
	out := make(map[string]string)
	var ves *types.ValidationErrors
	var ve *types.ValidationError
	switch {
	case errors.As(err, &ves):
		for _, e := range ves.Errs {
			out[validationErrLoc(e)] = e.Msg
		}
	case errors.As(err, &ve):
		out[validationErrLoc(ve)] = ve.Msg
	}
	return out
}

func validationErrLoc(ve *types.ValidationError) string {
	if ve.Loc == nil || len(*ve.Loc) == 0 {
		return "/"
	}
	return "/" + strings.Join(*ve.Loc, "/")
}
