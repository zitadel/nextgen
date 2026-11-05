package migratev4

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
)

func TestMigrationLoginFlow(t *testing.T) {
	for _, identifier := range []string{IdentifierEmail, IdentifierLoginName} {
		for _, register := range []bool{false, true} {
			for _, slugs := range [][]string{nil, {"corporate-sso"}} {
				document, err := migrationLoginFlow(identifier, register, slugs)
				require.NoError(t, err)
				flow, err := flow_definitions.ParseFlowDefinition(testBase, "proj_test", document)
				require.NoError(t, err)
				schemaDocument, err := userSchema(testBase, identifier, slugs)
				require.NoError(t, err)
				schema, err := domain.NewJSONSchema("proj_test", schemaDocument)
				require.NoError(t, err)
				compiled, err := schema.Document()
				require.NoError(t, err)
				_, err = domain.ValidateFlowDefinition(compiled, *flow)
				require.NoError(t, err, "identifier=%s register=%v slugs=%v", identifier, register, slugs)
				require.Equal(t, []domain.Field{domain.Field(identifier)}, flow.Steps[0].Fields)
				_, hasRegister := flow.Purposes[domain.FlowDefinitionPurposeRegister]
				require.Equal(t, register, hasRegister)
			}
		}
	}
}

func TestCreationPolicyTruthTable(t *testing.T) {
	for _, allowed := range []bool{false, true} {
		for _, auto := range []bool{false, true} {
			doc := connectionDocument(&idpPlan{idp: &stage.IDP{Options: stage.IDPOptions{IsCreationAllowed: allowed, IsAutoCreation: auto}}})
			want := "disabled"
			if allowed && auto {
				want = "auto"
			}
			require.Equal(t, want, doc["provisioning"].(map[string]any)["creation"])
		}
	}
}

func TestSafetyPoliciesAreBlockers(t *testing.T) {
	hashers, err := (&crypto.HashConfig{Verifiers: []crypto.HashName{crypto.HashNameBcrypt}, Hasher: crypto.HasherConfig{Algorithm: crypto.HashNameBcrypt, Params: map[string]any{"cost": 10}}}).NewHasherFactory()
	require.NoError(t, err)
	for _, tc := range []struct {
		code   string
		change func(*snapshot)
	}{
		{"idp_creation_policy_unsupported", func(s *snapshot) { s.instance.IDPs["idp-sso"].Options.IsAutoCreation = false }},
		{"idp_creation_policy_unsupported", func(s *snapshot) { s.instance.IDPs["idp-sso"].Options.IsCreationAllowed = false }},
		{"idp_linking_policy_unsupported", func(s *snapshot) { s.instance.IDPs["idp-sso"].Options.IsLinkingAllowed = true }},
		{"org_login_policy_unsupported", func(s *snapshot) { s.orgs["org-acme"].HasLoginPolicy = true }},
		{"password_change_required", func(s *snapshot) { s.users["u-alice"].PasswordChangeRequired = true }},
		{"mfa_enrollment_unsupported", func(s *snapshot) { s.users["u-alice"].TOTP = true }},
		{"user_state_unsupported", func(s *snapshot) { s.users["u-alice"].State = stage.StateInitial }},
		{"password_login_disabled", func(s *snapshot) { s.instance.LoginPolicy.AllowUsernamePassword = false }},
		{"user_owner_missing", func(s *snapshot) { s.orgs["org-acme"].State = "" }},
	} {
		t.Run(tc.code, func(t *testing.T) {
			snap := snapshotFixture(t)
			tc.change(snap)
			report := &Report{}
			_, err := buildPlan(snap, Options{Identifier: IdentifierEmail, DefaultOrgUsers: DefaultOrgUsersTeam}, hashers.Default(), testBase, nil, report)
			require.NoError(t, err)
			found := false
			for _, issue := range report.Issues {
				if issue.Code == tc.code && issue.Severity == SeverityConflict {
					found = true
				}
				require.Empty(t, issue.Detail)
			}
			require.True(t, found, "expected blocker %s", tc.code)
			require.True(t, report.blocked())
		})
	}
}

func TestCanonicalDocumentFingerprint(t *testing.T) {
	require.Equal(t, fingerprint(json.RawMessage(`{"a":1,"b":2}`)), fingerprint(json.RawMessage(`{"b":2, "a":1}`)))
	opts := Options{}
	opts.defaults()
	require.Equal(t, DefaultOrgUsersTeam, opts.DefaultOrgUsers)
}
