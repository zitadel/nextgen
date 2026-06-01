package domain_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func errorDetails(t *testing.T, err error) string {
	t.Helper()
	var domErr domain.Error
	if !errors.As(err, &domErr) {
		return err.Error()
	}
	if domErr.Details == nil {
		return domErr.Error()
	}
	return fmt.Sprint(domErr.Details)
}

// userSchemaIDAndPassword exposes one x-unique email field and one
// x-password field with password enabled at the schema root.
var userSchemaIDAndPassword = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tenant.com/schemas/idpw-user.json",
  "type": "object",
  "required": ["email"],
  "x-auth-methods": {
    "password": { "enabled": true, "position": 0 }
  },
  "properties": {
    "email":    { "type": "string", "format": "email", "x-unique": "team" },
    "password": { "type": "string", "minLength": 8, "x-password": true }
  }
}`)

func mustSchema(t *testing.T, raw []byte) *jsonschema.Schema {
	t.Helper()
	var s jsonschema.Schema
	require.NoError(t, json.Unmarshal(raw, &s))
	return &s
}

// Flip-table coverage: combined login + register entry must wire
// user_not_found.
func TestValidator_FlipTable_CombinedLoginRegisterRequiresUserNotFound(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	createUser := domain.FlowOnSuccessCreateUser
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "combined",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identify",
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []string{"email"},
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "signin"},
					// no user_not_found, no user_already_exists
				},
			},
			{
				Name:      "signin",
				Fields:    []string{"email", "password"},
				OnSuccess: &createUser,
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	details := errorDetails(t, err)
	// Map iteration order is non-deterministic, so the validator may
	// surface either missing flip outcome first; both prove the rule fires.
	assert.True(t,
		strings.Contains(details, "user_not_found") || strings.Contains(details, "user_already_exists"),
		"want flip-coverage error, got: %s", details)
}

// Solo-purpose login flow does NOT need user_not_found wired.
func TestValidator_FlipTable_SoloLoginNoFlipRequired(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "solo-login",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "credentials",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "credentials",
				Fields: []string{"email", "password"},
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.NoError(t, err)
}

// Manifest cross-check: create_user must have password collected
// somewhere upstream (or on the step itself).
func TestValidator_Manifest_CreateUserRequiresPasswordUpstream(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	createUser := domain.FlowOnSuccessCreateUser
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "missing-password",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []string{"email"},
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "create"},
				},
			},
			{
				Name:      "create",
				Fields:    []string{"email"},
				OnSuccess: &createUser,
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.Error(t, err)
	assert.Contains(t, errorDetails(t, err), "password")
}

// Worked example A: register-only, multi-step. Identifier on profile,
// password on set-password, create_user on confirm.
func TestValidator_PositiveWorkedExampleA(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	createUser := domain.FlowOnSuccessCreateUser
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "multi-signup",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "profile",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "profile",
				Fields: []string{"email"},
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "set-password"},
				},
			},
			{
				Name:   "set-password",
				Fields: []string{"password"},
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "confirm"},
				},
			},
			{
				Name:      "confirm",
				Fields:    []string{"email"},
				OnSuccess: &createUser,
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.NoError(t, err)
}

// Worked example C: combined login+register with both flip outcomes
// wired.
func TestValidator_PositiveWorkedExampleC(t *testing.T) {
	schema := mustSchema(t, userSchemaIDAndPassword)
	createUser := domain.FlowOnSuccessCreateUser
	def := domain.FlowDefinition{
		ProjectID:     "p",
		Name:          "combined",
		SchemaVersion: "1.0.0",
		UserSchema:    "https://tenant.com/schemas/idpw-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identify",
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []string{"email"},
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit":              {Target: "signin"},
					"user_not_found":      {Target: "register"},
					"user_already_exists": {Target: "signin"},
				},
			},
			{
				Name:   "signin",
				Fields: []string{"password"},
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{
				Name:      "register",
				Fields:    []string{"email", "password"},
				OnSuccess: &createUser,
				Actions: map[string]domain.FlowStepAction{
					"submit": {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"submit": {Target: "done"},
				},
			},
			{Name: "done", Complete: gu.Ptr(domain.FlowStepCompleteShow)},
		},
	}
	_, err := domain.ValidateFlowDefinition(schema, def)
	require.NoError(t, err)
}
