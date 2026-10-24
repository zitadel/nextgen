package migratev4

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

const testBase = configdefaults.DefaultBuiltinSchemaBase

func TestLoginFlowWithSSO_ValidatesAgainstTheV4Schema(t *testing.T) {
	slugs := []string{"corporate-sso", "google"}
	document, err := loginFlowWithSSO(configdefaults.DefaultLoginFlowDefinition(), slugs)
	require.NoError(t, err)

	def, err := flow_definitions.ParseFlowDefinition(testBase, "proj_test", document)
	require.NoError(t, err)
	schemaDocument, err := userSchema(testBase, IdentifierEmail, slugs)
	require.NoError(t, err)
	schema, err := domain.NewJSONSchema("proj_test", schemaDocument)
	require.NoError(t, err)
	compiled, err := schema.Document()
	require.NoError(t, err)
	_, err = domain.ValidateFlowDefinition(compiled, *def)
	require.NoError(t, err, "the flow the migrator writes must pass the server's validation")

	steps := map[string]domain.FlowDefinitionStep{}
	var order []string
	for _, step := range def.Steps {
		steps[step.Name] = step
		order = append(order, step.Name)
	}
	for _, name := range []string{"identifier", "register", "password", "sso-conflict"} {
		assert.Equal(t, slugs, steps[name].SSOProviders, name)
		assert.Equal(t, "done", steps[name].Transitions["sso_authenticated"].Target, name)
	}
	assert.Equal(t, "sso-conflict", steps["register-password"].Transitions["user_already_exists"].Target)
	assert.Equal(t, []string{"identifier", "password", "register", "register-password", "register-sso", "sso-conflict", "done"}, order)

	again, err := loginFlowWithSSO(document, slugs)
	require.NoError(t, err)
	assert.JSONEq(t, string(document), string(again), "wiring the same providers twice changes nothing")
}

func TestDeriveSlug(t *testing.T) {
	taken := map[string]bool{}
	assert.Equal(t, "corporate-sso", deriveSlug("Corporate SSO", "396264293663834310", taken))
	taken["corporate-sso"] = true
	assert.Equal(t, "corporate-sso-63834310", deriveSlug("Corporate  SSO!", "396264293663834310", taken))
	assert.Equal(t, "idp", deriveSlug("🔐", "1", map[string]bool{}))
}

// snapshotFixture is a v4 instance as the stage would hold it.
func snapshotFixture(t *testing.T) *snapshot {
	t.Helper()
	hash := func(password string) string {
		h, err := bcrypt.GenerateFromPassword([]byte(password), 10)
		require.NoError(t, err)
		return string(h)
	}
	mustBeDomain := true
	at := func(n int) time.Time { return time.Date(2025, 1, 1, 0, 0, n, 0, time.UTC) }
	secret := &v4.CryptoValue{Algorithm: "aes", KeyID: "idpConfigKey", Crypted: []byte("x")}
	return &snapshot{
		instance: &stage.Instance{
			Name:         "Acme Corp",
			DefaultOrgID: "org-default",
			Domains:      map[string]bool{"acme.localhost": true},
			LoginPolicy:  stage.LoginPolicy{AllowExternalIDP: true},
			LoginIDPs:    []string{"idp-sso"},
			IDPs: map[string]*stage.IDP{
				"idp-sso":    {ID: "idp-sso", Name: "Corporate SSO", Type: stage.IDPOIDC, Issuer: "https://sso.example.com", ClientID: "corp", ClientSecret: secret, UsePKCE: true, Options: stage.IDPOptions{IsCreationAllowed: true}},
				"idp-github": {ID: "idp-github", Name: "GitHub", Type: "github"},
			},
		},
		orgs: map[string]*stage.Org{
			"org-default": {Name: "Default", State: stage.OrgActive, CreatedAt: at(1)},
			"org-acme":    {Name: "Acme", State: stage.OrgActive, CreatedAt: at(2)},
			"org-globex":  {Name: "Globex", State: stage.OrgActive, CreatedAt: at(3), PrimaryDomain: "globex.localhost", Domains: map[string]bool{"globex.localhost": true}, UserLoginMustBeDomain: &mustBeDomain},
			"org-initech": {Name: "acme", State: stage.OrgInactive, CreatedAt: at(4)},
			"org-gone":    {Name: "Umbrella", State: stage.OrgRemoved, CreatedAt: at(5)},
		},
		orgSeq: map[string]int64{},
		users: map[string]*stage.User{
			"u-alice":   {OrgID: "org-acme", State: stage.StateActive, Username: "alice", Email: "alice@acme.test", EmailVerified: true, PasswordHash: hash("Alice-1"), CreatedAt: at(10), Links: map[string]stage.Link{stage.LinkKey("idp-sso", "sub-a"): {IDPID: "idp-sso", ExternalUserID: "sub-a"}, stage.LinkKey("idp-github", "42"): {IDPID: "idp-github", ExternalUserID: "42"}}},
			"u-alice-g": {OrgID: "org-globex", State: stage.StateActive, Username: "alice", Email: "alice@globex.test", PasswordHash: hash("Alice-2"), CreatedAt: at(11)},
			"u-dup":     {OrgID: "org-acme", State: stage.StateActive, Username: "dup", Email: "ALICE@acme.test", CreatedAt: at(12)},
			"u-bob":     {OrgID: "org-default", State: stage.StateLocked, Username: "bob", Email: "bob@example.test", PasswordHash: "5f4dcc3b5aa765d61d8327deb882cf99", CreatedAt: at(13)},
			"u-albert":  {OrgID: "org-gone", State: stage.StateActive, Username: "albert", Email: "albert@example.test", CreatedAt: at(14)},
			"u-rita":    {OrgID: "org-default", State: stage.StateDeleted, Username: "rita", Email: "rita@example.test", CreatedAt: at(15)},
			"u-ci":      {OrgID: "org-acme", Machine: true, State: stage.StateActive, Username: "ci", PATs: map[string]bool{"t": true}, CreatedAt: at(16)},
		},
		userSeq: map[string]int64{},
		objects: map[string]map[string]*stage.Object{},
	}
}

func TestBuildPlan(t *testing.T) {
	hashers, err := (&crypto.HashConfig{
		Verifiers: []crypto.HashName{crypto.HashNameBcrypt},
		Hasher:    crypto.HasherConfig{Algorithm: crypto.HashNameBcrypt, Params: map[string]any{"cost": 10}},
		Limits:    crypto.HashLimitsConfig{Bcrypt: crypto.BcryptLimitsConfig{MinCost: 10, MaxCost: 16}},
	}).NewHasherFactory()
	require.NoError(t, err)

	report := &Report{}
	p, err := buildPlan(snapshotFixture(t), Options{Identifier: IdentifierEmail, DefaultOrgUsers: DefaultOrgUsersSelf}, hashers.Default(), testBase, nil, report)
	require.NoError(t, err)

	teams := map[string]string{}
	for _, team := range p.teams {
		teams[team.orgID] = team.name
	}
	assert.Equal(t, map[string]string{"org-acme": "Acme", "org-globex": "Globex", "org-initech": "acme (v4 org-initech)"}, teams,
		"no team for the default org, none for a removed one, and a case-insensitive clash renamed")
	assert.True(t, p.teamByOrg["org-initech"].deactivate)

	users := map[string]*userPlan{}
	for _, u := range p.users {
		users[u.userID] = u
	}
	require.Len(t, users, 3, "alice, alice of Globex and bob; the duplicate email, the removed, the orphaned and the machine user stay behind")
	assert.Equal(t, "alice", users["u-alice"].attributes["login_name"])
	assert.Equal(t, "alice@globex.localhost", users["u-alice-g"].attributes["login_name"], "Globex suffixes login names with its primary domain")
	assert.Nil(t, users["u-bob"].team, "the default org's users are self-owned")
	assert.True(t, users["u-bob"].deactivate, "locked becomes deactivated")
	assert.Empty(t, users["u-bob"].passwordHash, "md5plain is not a configured verifier")
	assert.NotEmpty(t, users["u-alice"].passwordHash)
	assert.Equal(t, []string{"u-albert", "u-rita"}, p.gone)

	require.Len(t, p.idps, 1)
	assert.Equal(t, "corporate-sso", p.idps[0].slug)
	assert.Equal(t, []string{"corporate-sso"}, p.loginSlugs)
	require.Len(t, p.links, 1, "the GitHub link stays behind with its IdP")
	assert.Equal(t, "sub-a", p.links[0].subject)

	document, err := json.Marshal(p.idps[0].document)
	require.NoError(t, err)
	assert.JSONEq(t, `{
		"slug": "corporate-sso",
		"protocol": "oidc",
		"display_name": "Corporate SSO",
		"claim_mapping": {"display_name": "name", "email": "email", "family_name": "family_name", "given_name": "given_name", "nickname": "nickname", "phone": "phone_number", "preferred_language": "locale"},
		"verified_claims": {"email": "email_verified"},
		"provisioning": {"creation": "auto"},
		"oidc": {
			"issuer": "https://sso.example.com",
			"client_id": "corp",
			"client_secret": "${{ V4_IDP_CORPORATE_SSO_CLIENT_SECRET }}",
			"scopes": ["openid"],
			"pkce_enabled": true,
			"id_token_mapping": false
		}
	}`, string(document))

	codes := map[string]int{}
	for _, issue := range report.Issues {
		codes[issue.Code]++
	}
	assert.Equal(t, map[string]int{"identifier_conflict": 1, "password_hash_rejected": 1, "team_name_taken": 1}, codes)
}
