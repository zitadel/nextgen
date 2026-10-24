package stage

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
)

// events builds a sequence of one aggregate's events, numbered from 1.
type events struct {
	aggregateType, aggregateID, owner string
	list                              []v4.Event
}

func (e *events) add(eventType string, payload any) *events {
	return e.addOwned(e.owner, eventType, payload)
}

func (e *events) addOwned(owner, eventType string, payload any) *events {
	var raw []byte
	if payload != nil {
		raw, _ = json.Marshal(payload)
	}
	e.list = append(e.list, v4.Event{
		AggregateType: e.aggregateType,
		AggregateID:   e.aggregateID,
		Type:          eventType,
		Sequence:      int64(len(e.list) + 1),
		CreatedAt:     time.Date(2025, 1, 1, 0, 0, len(e.list), 0, time.UTC),
		Owner:         owner,
		Payload:       raw,
	})
	return e
}

func fold(t *testing.T, e *events) Doc {
	t.Helper()
	st := &Staged{Key: v4.AggregateKey{Type: e.aggregateType, ID: e.aggregateID}, Doc: NewDoc(e.aggregateType)}
	require.NoError(t, st.Fold(e.list))
	return st.Doc
}

func TestUser_HumanLifecycle(t *testing.T) {
	e := &events{aggregateType: "user", aggregateID: "u1", owner: "org1"}
	e.add("user.human.added", map[string]any{
		"userName": "alice", "firstName": "Alice", "lastName": "Doe", "displayName": "Alice Doe",
		"preferredLanguage": "en", "gender": 1, "email": "alice@example.com", "phone": "+41790000000",
		"encodedHash": "$2a$14$abc", "changeRequired": true,
	}).
		add("user.human.email.verified", nil).
		add("user.human.phone.verified", nil).
		add("user.human.profile.changed", map[string]any{"displayName": "Ali", "firstName": ""}).
		add("user.human.email.changed", map[string]any{"email": "ali@example.com"}).
		add("user.human.password.hash.updated", map[string]any{"encodedHash": "$argon2id$v=19$m=65536,t=3,p=4$x$y"}).
		add("user.locked", nil)

	u := fold(t, e).(*User)
	assert.Equal(t, "org1", u.OrgID)
	assert.Equal(t, StateLocked, u.State)
	assert.Equal(t, "alice", u.Username)
	assert.Equal(t, "Alice", u.FirstName, "an empty first name in profile.changed means unchanged")
	assert.Equal(t, "Ali", u.DisplayName)
	assert.Equal(t, "ali@example.com", u.Email)
	assert.False(t, u.EmailVerified, "a changed email is unverified")
	assert.True(t, u.PhoneVerified)
	assert.Equal(t, "$argon2id$v=19$m=65536,t=3,p=4$x$y", u.PasswordHash)
	assert.True(t, u.PasswordChangeRequired)

	e.add("user.unlocked", nil).add("user.deactivated", nil)
	assert.Equal(t, StateInactive, fold(t, e).(*User).State)
	e.add("user.reactivated", nil).add("user.removed", nil)
	assert.Equal(t, StateDeleted, fold(t, e).(*User).State)
}

func TestUser_V1EventsAndLegacySecret(t *testing.T) {
	e := &events{aggregateType: "user", aggregateID: "u1", owner: "org1"}
	// Old events keep the bcrypt hash as the bytes of a CryptoValue.
	legacy := map[string]any{"CryptoType": 1, "Algorithm": "bcrypt", "KeyID": "", "Crypted": []byte("$2a$10$legacy")}
	e.add("user.added", map[string]any{"userName": "bob", "email": "bob@example.com", "secret": legacy}).
		add("user.initialization.code.added", map[string]any{})

	u := fold(t, e).(*User)
	assert.Equal(t, "$2a$10$legacy", u.PasswordHash)
	assert.Equal(t, StateInitial, u.State)

	e.add("user.initialization.check.succeeded", nil).
		add("user.password.changed", map[string]any{"secret": map[string]any{"CryptoType": 1, "Algorithm": "bcrypt", "Crypted": []byte("$2a$10$newer")}, "changeRequired": false})
	u = fold(t, e).(*User)
	assert.Equal(t, StateActive, u.State)
	assert.Equal(t, "$2a$10$newer", u.PasswordHash)
}

func TestUser_IDReuseStartsOverUnderTheNewOrg(t *testing.T) {
	e := &events{aggregateType: "user", aggregateID: "u1", owner: "org1"}
	e.add("user.human.added", map[string]any{"userName": "carol", "email": "c@example.com", "encodedHash": "$2a$x"}).
		add("user.human.externalidp.added", map[string]any{"idpConfigId": "idp1", "userId": "sub-1"}).
		add("user.removed", nil).
		addOwned("org2", "user.human.added", map[string]any{"userName": "carol2", "email": "c2@example.com"})

	u := fold(t, e).(*User)
	assert.Equal(t, "org2", u.OrgID)
	assert.Equal(t, StateActive, u.State)
	assert.Equal(t, "carol2", u.Username)
	assert.Empty(t, u.PasswordHash)
	assert.Empty(t, u.Links)
}

func TestUser_Links(t *testing.T) {
	e := &events{aggregateType: "user", aggregateID: "u1", owner: "org1"}
	e.add("user.human.added", map[string]any{"userName": "dave", "email": "d@example.com"}).
		add("user.human.externalidp.added", map[string]any{"idpConfigId": "idp1", "userId": "old", "displayName": "dave@idp"}).
		add("user.human.externalidp.added", map[string]any{"idpConfigId": "idp2", "userId": "12345"}).
		add("user.human.externalidp.id.migrated", map[string]any{"idpConfigId": "idp1", "previousId": "old", "newId": "new"}).
		add("user.human.externalidp.removed", map[string]any{"idpConfigId": "idp2", "userId": "12345"})

	u := fold(t, e).(*User)
	require.Len(t, u.Links, 1)
	link := u.Links[LinkKey("idp1", "new")]
	assert.Equal(t, Link{IDPID: "idp1", ExternalUserID: "new", DisplayName: "dave@idp"}, link)
}

func TestUser_FactorsAndMachines(t *testing.T) {
	e := &events{aggregateType: "user", aggregateID: "u1", owner: "org1"}
	e.add("user.human.added", map[string]any{"userName": "erin", "email": "e@example.com"}).
		add("user.human.mfa.otp.added", map[string]any{"otpSecret": map[string]any{"Algorithm": "aes"}}).
		add("user.human.mfa.otp.verified", map[string]any{}).
		add("user.human.passwordless.token.verified", map[string]any{"webAuthNTokenId": "pk1"}).
		add("user.human.mfa.u2f.token.verified", map[string]any{"webAuthNTokenId": "u1"}).
		add("user.human.mfa.u2f.token.removed", map[string]any{"webAuthNTokenId": "u1"}).
		add("user.metadata.set", map[string]any{"key": "plan", "value": []byte("pro")})
	u := fold(t, e).(*User)
	assert.True(t, u.TOTP)
	assert.Len(t, u.Passkeys, 1)
	assert.Empty(t, u.U2F)
	assert.Len(t, u.MetadataKeys, 1)

	m := &events{aggregateType: "user", aggregateID: "m1", owner: "org1"}
	m.add("user.machine.added", map[string]any{"userName": "ci-bot", "name": "CI"}).
		add("user.pat.added", map[string]any{"tokenId": "t1"}).
		add("user.machine.key.added", map[string]any{"keyId": "k1"})
	machine := fold(t, m).(*User)
	assert.True(t, machine.Machine)
	assert.Len(t, machine.PATs, 1)
	assert.Len(t, machine.MachineKeys, 1)
}

func TestFold_SkipsWhatIsAlreadyStaged(t *testing.T) {
	e := &events{aggregateType: "user", aggregateID: "u1", owner: "org1"}
	e.add("user.human.added", map[string]any{"userName": "frank", "email": "f@example.com"}).
		add("user.locked", nil)
	st := &Staged{Key: v4.AggregateKey{Type: "user", ID: "u1"}, Doc: &User{State: StateActive, Username: "frank"}, Sequence: 2}
	require.NoError(t, st.Fold(e.list))
	assert.Equal(t, StateActive, st.Doc.(*User).State, "events at or below the staged sequence are not folded again")
}

func TestInstance_IDPs(t *testing.T) {
	secret := map[string]any{"CryptoType": 0, "Algorithm": "aes", "KeyID": "idpConfigKey", "Crypted": []byte("0123456789abcdef-s")}
	e := &events{aggregateType: "instance", aggregateID: "i1", owner: "i1"}
	e.add("instance.added", map[string]any{"name": "Acme"}).
		add("instance.default.org.set", map[string]any{"orgId": "org0"}).
		add("instance.policy.login.added", map[string]any{"allowUsernamePassword": true, "allowExternalIdp": true}).
		add("instance.idp.oidc.added", map[string]any{
			"id": "idp1", "name": "Corporate SSO", "issuer": "https://sso.example.com", "clientId": "corp",
			"clientSecret": secret, "scopes": []string{"openid", "email"}, "usePKCE": true, "isCreationAllowed": true,
		}).
		add("instance.idp.oidc.changed", map[string]any{"id": "idp1", "name": "Corp SSO", "isAutoCreation": true}).
		add("instance.policy.login.idpprovider.added", map[string]any{"idpConfigId": "idp1", "idpProviderType": 0}).
		add("iam.idp.config.added", map[string]any{"idpConfigId": "idp2", "name": "Legacy", "idpType": 0, "autoRegister": true}).
		add("iam.idp.oidc.config.added", map[string]any{"idpConfigId": "idp2", "clientId": "legacy", "issuer": "https://legacy.example.com", "scopes": []string{"openid"}}).
		add("instance.idp.oidc.added", map[string]any{"id": "idp3", "name": "To Google", "issuer": "https://accounts.google.com", "clientId": "g"}).
		add("instance.idp.oidc.migrated.google", map[string]any{"id": "idp3", "name": "Google", "clientId": "g2", "clientSecret": secret}).
		add("instance.idp.github.added", map[string]any{"id": "idp4", "name": "GitHub", "clientId": "gh"}).
		add("instance.idp.ldap.v2.added", map[string]any{"id": "idp5", "name": "LDAP"}).
		add("instance.idp.removed", map[string]any{"id": "idp5"})

	inst := fold(t, e).(*Instance)
	assert.Equal(t, "Acme", inst.Name)
	assert.Equal(t, "org0", inst.DefaultOrgID)
	assert.True(t, inst.LoginPolicy.AllowExternalIDP)
	assert.Equal(t, []string{"idp1"}, inst.LoginIDPs)

	idp1 := inst.IDPs["idp1"]
	assert.Equal(t, IDPOIDC, idp1.Type)
	assert.Equal(t, "Corp SSO", idp1.Name)
	assert.Equal(t, "https://sso.example.com", idp1.Issuer, "a changed event keeps what it does not carry")
	assert.True(t, idp1.UsePKCE)
	assert.True(t, idp1.Options.IsCreationAllowed)
	assert.True(t, idp1.Options.IsAutoCreation)
	require.NotNil(t, idp1.ClientSecret)
	assert.Equal(t, "idpConfigKey", idp1.ClientSecret.KeyID)

	legacy := inst.IDPs["idp2"]
	assert.True(t, legacy.Legacy)
	assert.Equal(t, IDPOIDC, legacy.Type)
	assert.Equal(t, "https://legacy.example.com", legacy.Issuer)
	assert.True(t, legacy.IDTokenMapping, "v4's projection reads legacy configs with id token mapping")
	assert.False(t, legacy.UsePKCE)
	assert.True(t, legacy.Options.IsCreationAllowed)
	assert.True(t, legacy.Options.IsAutoCreation, "autoRegister")

	assert.Equal(t, IDPGoogle, inst.IDPs["idp3"].Type)
	assert.Equal(t, "g2", inst.IDPs["idp3"].ClientID)
	assert.Equal(t, "github", inst.IDPs["idp4"].Type)
	assert.Equal(t, "ldap", inst.IDPs["idp5"].Type)
	assert.True(t, inst.IDPs["idp5"].Removed)
}

func TestOrg_DomainsPolicyAndRemoval(t *testing.T) {
	e := &events{aggregateType: "org", aggregateID: "org1", owner: "org1"}
	e.add("org.added", map[string]any{"name": "Globex"}).
		add("org.domain.added", map[string]any{"domain": "globex.localhost"}).
		add("org.domain.verified", map[string]any{"domain": "globex.localhost"}).
		add("org.domain.primary.set", map[string]any{"domain": "globex.localhost"}).
		add("org.domain.added", map[string]any{"domain": "unverified.example.com"}).
		add("org.policy.domain.added", map[string]any{"userLoginMustBeDomain": true}).
		add("org.deactivated", nil)

	org := fold(t, e).(*Org)
	assert.Equal(t, "Globex", org.Name)
	assert.Equal(t, OrgInactive, org.State)
	assert.Equal(t, "globex.localhost", org.PrimaryDomain)
	assert.Equal(t, map[string]bool{"globex.localhost": true, "unverified.example.com": false}, org.Domains)
	require.NotNil(t, org.UserLoginMustBeDomain)
	assert.True(t, *org.UserLoginMustBeDomain)

	e.add("org.policy.domain.removed", nil).add("org.removed", nil)
	org = fold(t, e).(*Org)
	assert.Nil(t, org.UserLoginMustBeDomain, "a removed org policy falls back to the instance's")
	assert.Equal(t, OrgRemoved, org.State)
}
