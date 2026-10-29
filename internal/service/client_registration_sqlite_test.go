//go:build sqlite_integration

package service_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// fakeConsents stands in for the authorization server's consents: named
// lists the client ids a live consent names, deleted records each client
// whose consents were deleted, and failDelete makes the next delete fail.
type fakeConsents struct {
	named      []string
	deleted    []string
	failDelete error
}

func (c *fakeConsents) Named(_ context.Context, _ service.AllStatements, _ string, clientIDs []string) ([]string, error) {
	var named []string
	for _, id := range clientIDs {
		if slices.Contains(c.named, id) {
			named = append(named, id)
		}
	}
	return named, nil
}

func (c *fakeConsents) Delete(_ context.Context, _ service.AllStatements, _, clientID string) error {
	if c.failDelete != nil {
		return c.failDelete
	}
	c.deleted = append(c.deleted, clientID)
	return nil
}

// agentMetadata is what an MCP client such as Claude Code registers with.
func agentMetadata() domain.ClientRegistrationMetadata {
	return domain.ClientRegistrationMetadata{
		ClientName:   "Claude Code (zitadel)",
		RedirectURIs: []string{"http://localhost:33418/callback"},
	}
}

func (f appFixture) events(t *testing.T, entityID string) []domain.EventType {
	t.Helper()
	result, err := f.pool.Statements().ListEvents(service.WithAuthzListUnrestricted(f.ctx), &database.ListOptions[domain.EventField]{
		Filter: database.And(
			database.Equal(database.Col(domain.EventFieldProjectID), f.projectID),
			database.Equal(database.Col(domain.EventFieldEntityID), entityID),
		),
	})
	require.NoError(t, err)
	var types []domain.EventType
	for _, event := range result.Items {
		types = append(types, event.EventType)
	}
	return types
}

func TestClientRegistrationService_Register(t *testing.T) {
	f := newAppFixture(t)
	registrations := service.NewClientRegistrationService(f.pool, service.NoConsents{})

	t.Run("a public client gets a minted client_id, RFC 7591's defaults and no secret", func(t *testing.T) {
		out, err := registrations.Register(f.ctx, service.RegisterClientInput{ProjectID: f.projectID, Metadata: agentMetadata()})
		require.NoError(t, err)
		assert.True(t, domain.PrefixClientRegistration.Matches(out.Registration.ID))
		assert.Equal(t, domain.ClientAuthNone, out.Registration.Metadata.AuthMethod)
		assert.Equal(t, []domain.GrantType{domain.GrantAuthorizationCode, domain.GrantRefreshToken}, out.Registration.Metadata.GrantTypes)
		assert.Empty(t, out.Secret)
		assert.WithinDuration(t, time.Now().Add(domain.ClientRegistrationLifetime), out.Registration.ExpiresAt, time.Minute)

		found, err := f.directory.ClientRegistration(f.ctx, f.at(), out.Registration.ID)
		require.NoError(t, err)
		assert.Equal(t, "Claude Code (zitadel)", found.Metadata.ClientName, "the consent step reads the client's own name")
		assert.ErrorIs(t, f.directory.VerifyClientRegistrationSecret(f.ctx, f.at(), found, "anything"), domain.ErrAppClientSecretInvalid(),
			"a public client has no secret to check")
		assert.Equal(t, []domain.EventType{domain.EventTypeClientRegistrationCreated}, f.events(t, out.Registration.ID))
	})

	t.Run("a confidential client's secret is returned once and checked against its hash", func(t *testing.T) {
		metadata := agentMetadata()
		metadata.RedirectURIs = []string{"https://agent.example.com/callback"}
		metadata.AuthMethod = domain.ClientAuthClientSecretBasic
		out, err := registrations.Register(f.ctx, service.RegisterClientInput{ProjectID: f.projectID, Metadata: metadata})
		require.NoError(t, err)
		require.NotEmpty(t, out.Secret)

		found, err := f.directory.ClientRegistration(f.ctx, f.at(), out.Registration.ID)
		require.NoError(t, err)
		assert.NotContains(t, found.SecretHash, out.Secret, "only the hash is stored")
		require.NoError(t, f.directory.VerifyClientRegistrationSecret(f.ctx, f.at(), found, out.Secret))
		assert.ErrorIs(t, f.directory.VerifyClientRegistrationSecret(f.ctx, f.at(), found, out.Secret+"x"), domain.ErrAppClientSecretInvalid())
	})

	t.Run("metadata a client may not register with is refused, and nothing is stored", func(t *testing.T) {
		metadata := agentMetadata()
		metadata.RedirectURIs = []string{"http://agent.example.com/callback"}
		_, err := registrations.Register(f.ctx, service.RegisterClientInput{ProjectID: f.projectID, Metadata: metadata})
		require.ErrorIs(t, err, domain.ErrClientRegistrationInvalid(nil))
		list, err := registrations.List(f.ctx, service.ListClientRegistrationsInput{ProjectID: f.projectID})
		require.NoError(t, err)
		assert.Len(t, list.Items, 2, "the two registrations above")
	})

	t.Run("the directory answers only a registration's own client_id, in its own project", func(t *testing.T) {
		_, err := f.directory.ClientRegistration(f.ctx, f.at(), "dcr_unknown")
		assert.ErrorIs(t, err, domain.ErrClientRegistrationNotFound())
		_, err = f.directory.ClientRegistration(f.ctx, f.at(), "ShopDesktop")
		assert.ErrorIs(t, err, domain.ErrClientRegistrationNotFound(), "an app client's id is not a registration")
		out, err := registrations.Register(f.ctx, service.RegisterClientInput{ProjectID: f.projectID, Metadata: agentMetadata()})
		require.NoError(t, err)
		_, err = f.directory.ClientRegistration(f.ctx, service.AppLookup{ProjectID: "proj_other"}, out.Registration.ID)
		assert.ErrorIs(t, err, domain.ErrClientRegistrationNotFound())
	})
}

// A registration nobody consented to goes once past its lifetime, with the
// next registration in the project; one a live consent names stays.
func TestClientRegistrationService_PurgesExpiredRegistrations(t *testing.T) {
	f := newAppFixture(t)
	consents := &fakeConsents{}
	registrations := service.NewClientRegistrationService(f.pool, consents)
	register := func() string {
		t.Helper()
		out, err := registrations.Register(f.ctx, service.RegisterClientInput{ProjectID: f.projectID, Metadata: agentMetadata()})
		require.NoError(t, err)
		return out.Registration.ID
	}
	expire := func(id string) {
		t.Helper()
		require.NoError(t, f.pool.Statements().ExtendClientRegistration(f.ctx, f.projectID, id, time.Now().Add(-time.Minute)))
	}

	unused, consented, fresh := register(), register(), register()
	expire(unused)
	expire(consented)
	consents.named = []string{consented}

	register()

	_, err := registrations.Get(f.ctx, f.projectID, unused)
	assert.ErrorIs(t, err, domain.ErrClientRegistrationNotFound(), "expired and named by no consent")
	assert.Equal(t, []string{unused}, consents.deleted, "a purged registration takes what still names it along")
	kept, err := registrations.Get(f.ctx, f.projectID, consented)
	require.NoError(t, err, "a live consent keeps it")
	assert.WithinDuration(t, time.Now().Add(domain.ClientRegistrationLifetime), kept.ExpiresAt, time.Minute,
		"checked again a lifetime later")
	_, err = registrations.Get(f.ctx, f.projectID, fresh)
	require.NoError(t, err, "not expired yet")
	assert.Equal(t, []domain.EventType{domain.EventTypeClientRegistrationCreated}, f.events(t, unused),
		"a purge is no actor's action and emits nothing")
}

func TestClientRegistrationService_Delete(t *testing.T) {
	f := newAppFixture(t)
	consents := &fakeConsents{}
	registrations := service.NewClientRegistrationService(f.pool, consents)
	out, err := registrations.Register(f.ctx, service.RegisterClientInput{ProjectID: f.projectID, Metadata: agentMetadata()})
	require.NoError(t, err)
	id := out.Registration.ID

	t.Run("a failed consent delete keeps the registration: both go in one transaction", func(t *testing.T) {
		consents.failDelete = errors.New("consents unavailable")
		require.Error(t, registrations.Delete(f.ctx, f.projectID, id))
		consents.failDelete = nil
		_, err := registrations.Get(f.ctx, f.projectID, id)
		require.NoError(t, err)
	})

	t.Run("delete takes the registration's consents and tokens with it", func(t *testing.T) {
		require.NoError(t, registrations.Delete(f.ctx, f.projectID, id))
		assert.Equal(t, []string{id}, consents.deleted)
		_, err := f.directory.ClientRegistration(f.ctx, f.at(), id)
		assert.ErrorIs(t, err, domain.ErrClientRegistrationNotFound(), "the authorization server no longer finds it")
		assert.Equal(t, []domain.EventType{domain.EventTypeClientRegistrationCreated, domain.EventTypeClientRegistrationDeleted}, f.events(t, id))
		assert.ErrorIs(t, registrations.Delete(f.ctx, f.projectID, id), domain.ErrClientRegistrationNotFound())
	})
}

// The authorization server opens a registration endpoint when an app that
// serves the request opens it: a declared app only at the revision the
// deployment's release pins.
func TestAppDirectory_Registration(t *testing.T) {
	f := newAppFixture(t)

	open, err := f.directory.Registration(f.ctx, f.at())
	require.NoError(t, err)
	assert.Equal(t, domain.AppRegistration{}, open, "no app, nothing open")

	_, err = f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(shopDocument))
	require.NoError(t, err)
	open, err = f.directory.Registration(f.ctx, f.at())
	require.NoError(t, err)
	assert.Equal(t, domain.AppRegistration{}, open, "an app that opens nothing")

	closed := f.build(t, `{"slug":"docs","name":"Docs","apis":[{"slug":"mcp","identifier":"https://docs.example.com/mcp","third_party":true}]}`)
	opened := f.build(t, `{"slug":"docs","name":"Docs","apis":[{"slug":"mcp","identifier":"https://docs.example.com/mcp","third_party":true}],
		"registration":{"dynamic":true}}`)
	before := service.AppLookup{ProjectID: f.projectID, DeploymentID: f.deploy(t, closed, "https://old.docs.example.com")}
	after := service.AppLookup{ProjectID: f.projectID, DeploymentID: f.deploy(t, opened, "https://docs.example.com")}

	open, err = f.directory.Registration(f.ctx, before)
	require.NoError(t, err)
	assert.False(t, open.Dynamic, "the old deployment pins the revision that did not open it")
	open, err = f.directory.Registration(f.ctx, after)
	require.NoError(t, err)
	assert.Equal(t, domain.AppRegistration{Dynamic: true}, open)

	builtin := service.NewAppDirectory(f.pool, nil, nil, nil, &domain.ResolvedApp{
		ProjectID: f.projectID, Slug: "zitadel", Source: domain.AppSourceBuiltin,
		Document: domain.AppDocument{Registration: domain.AppRegistration{ClientIDMetadataDocuments: true}},
	})
	open, err = builtin.Registration(f.ctx, after)
	require.NoError(t, err)
	assert.Equal(t, domain.AppRegistration{ClientIDMetadataDocuments: true, Dynamic: true}, open, "built-in and stored apps together")
}
