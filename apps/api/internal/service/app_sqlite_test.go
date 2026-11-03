//go:build sqlite_integration

package service_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
	"github.com/zitadel/nextgen/internal/storage/dialect/sqlite"
)

// appFixture is the app service, its release build and its directory over one
// SQLite database, with a project to write into. The point is the rows the
// three share: what a write stores is what the authorization server reads.
type appFixture struct {
	ctx       context.Context
	pool      *service.DB
	apps      service.AppService
	releases  service.ReleaseService
	directory service.AppDirectory
	projectID string
}

func newAppFixture(t *testing.T) appFixture {
	t.Helper()
	ctx := t.Context()
	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	const projectID = "proj_apps"
	require.NoError(t, sqlite.SeedProjectsTiedAt(ctx, dbPool, []string{projectID}, time.Now()))

	validator, err := domain.NewSchemaValidator("https://example.com/api/schemas")
	require.NoError(t, err)
	hashers, err := (&crypto.HashConfig{
		Verifiers: []crypto.HashName{crypto.HashNameBcrypt},
		Hasher:    crypto.HasherConfig{Algorithm: crypto.HashNameBcrypt, Params: map[string]any{"cost": 4}},
		Limits:    crypto.HashLimitsConfig{Bcrypt: crypto.BcryptLimitsConfig{MinCost: 4, MaxCost: 16}},
	}).NewHasherFactory()
	require.NoError(t, err)

	pool := service.NewPool(dbPool)
	apps := service.NewAppService(pool, validator, hashers.Default())
	return appFixture{
		ctx:       ctx,
		pool:      pool,
		apps:      apps,
		releases:  service.NewReleaseService(pool, nil, nil, nil, nil, apps, nil, testBuiltinBases),
		directory: service.NewAppDirectory(pool, nil, nil, hashers.Default()),
		projectID: projectID,
	}
}

func (f appFixture) at() service.AppLookup {
	return service.AppLookup{ProjectID: f.projectID}
}

// shopDocument is a registered app: a confidential web client whose secret
// the server generates, a public client that keeps an id it already had, and
// an API.
const shopDocument = `{
  "slug": "shop", "name": "Shop",
  "clients": [
    {"slug": "web", "type": "confidential", "grant_types": ["authorization_code", "refresh_token"],
     "redirect_uris": ["https://shop.example.com/callback"], "apis": [{"api": "orders"}]},
    {"slug": "desktop", "client_id": "ShopDesktop", "type": "public", "grant_types": ["authorization_code"],
     "redirect_uris": ["http://127.0.0.1/callback"], "apis": [{"api": "orders", "scopes": ["orders.read"]}]}
  ],
  "apis": [{"slug": "orders", "identifier": "https://api.shop.example.com",
    "scopes": [{"name": "orders.read"}, {"name": "orders.write"}]}]
}`

func clientIDs(view service.AppView) map[string]string {
	ids := map[string]string{}
	for _, row := range view.Clients {
		ids[row.Slug] = row.ClientID
	}
	return ids
}

func TestAppService_RegisteredApp(t *testing.T) {
	f := newAppFixture(t)

	created, err := f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(shopDocument))
	require.NoError(t, err)
	assert.True(t, created.Created)
	assert.Equal(t, domain.AppSourceRegistered, created.App.Source)
	ids := clientIDs(created.AppView)
	assert.True(t, domain.PrefixAppClient.Matches(ids["web"]), "a client without a client_id gets a minted one, got %q", ids["web"])
	assert.Equal(t, "ShopDesktop", ids["desktop"], "a chosen client_id is kept")
	require.Len(t, created.Secrets, 1, "only the confidential client gets a secret")
	assert.True(t, strings.HasPrefix(created.Secrets["web"].Secret, "zcs_"))
	assert.True(t, domain.PrefixAppClientCredential.Matches(created.Secrets["web"].CredentialID))

	t.Run("a revision keeps every client_id and generates no second secret", func(t *testing.T) {
		revised, err := f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(strings.Replace(shopDocument, `"name": "Shop"`, `"name": "Shop 2"`, 1)))
		require.NoError(t, err)
		assert.False(t, revised.Created)
		assert.Equal(t, created.App.ID, revised.App.ID)
		assert.NotEqual(t, created.App.RevisionID, revised.App.RevisionID)
		assert.Equal(t, ids, clientIDs(revised.AppView))
		assert.Empty(t, revised.Secrets)
	})

	t.Run("a revision may not change a client's id", func(t *testing.T) {
		_, err := f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(strings.Replace(shopDocument, "ShopDesktop", "Other", 1)))
		require.ErrorIs(t, err, domain.ErrAppFieldImmutable(nil))
	})

	t.Run("another app may not take a client_id or an identifier", func(t *testing.T) {
		_, err := f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(`{"slug":"thief","name":"Thief","clients":[
			{"slug":"c","client_id":"ShopDesktop","type":"public","grant_types":["authorization_code"],"redirect_uris":["https://thief.example/cb"]}]}`))
		require.ErrorIs(t, err, domain.ErrAppClientIDTaken(nil))
		_, err = f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(`{"slug":"thief","name":"Thief","apis":[
			{"slug":"a","identifier":"https://api.shop.example.com"}]}`))
		require.ErrorIs(t, err, domain.ErrAppIdentifierTaken(nil))
	})

	t.Run("the directory finds clients and APIs by the ids requests carry", func(t *testing.T) {
		app, client, err := f.directory.Client(f.ctx, f.at(), ids["web"])
		require.NoError(t, err)
		assert.Equal(t, "shop", app.Slug)
		assert.Equal(t, "web", client.Slug)
		assert.Equal(t, ids["web"], client.ClientID)
		assert.False(t, client.IsFirstParty(app.Source), "a registered app's client is third-party by default")

		_, desktop, err := f.directory.Client(f.ctx, f.at(), "ShopDesktop")
		require.NoError(t, err)
		apiApp, orders, err := f.directory.API(f.ctx, f.at(), "https://api.shop.example.com")
		require.NoError(t, err)
		assert.Equal(t, domain.ClientAPIAccess{Allowed: true, Scopes: []string{"orders.read"}}, app.AccessTo(desktop, apiApp, orders))

		_, _, err = f.directory.Client(f.ctx, f.at(), "nobody")
		require.ErrorIs(t, err, domain.ErrAppClientNotFound())
		_, _, err = f.directory.API(f.ctx, f.at(), "https://nowhere.example")
		require.ErrorIs(t, err, domain.ErrAppAPINotFound())
	})

	t.Run("a generated secret verifies, a wrong or malformed one does not", func(t *testing.T) {
		app, web, err := f.directory.Client(f.ctx, f.at(), ids["web"])
		require.NoError(t, err)
		secret := created.Secrets["web"].Secret
		require.NoError(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, web, secret))
		require.ErrorIs(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, web, "zcs_wrong"), domain.ErrAppClientSecretInvalid())
		typo := secret[:10] + string(secret[10]^1) + secret[11:]
		require.ErrorIs(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, web, typo), domain.ErrAppClientSecretInvalid(),
			"the checksum catches a typo")
	})

	t.Run("an imported bcrypt hash verifies and is moved to the server's hash", func(t *testing.T) {
		hash, err := bcrypt.GenerateFromPassword([]byte("from-v4"), 4)
		require.NoError(t, err)
		added, err := f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: created.App.ID, ClientSlug: "web", Name: "from-v4", Hash: string(hash),
		})
		require.NoError(t, err)
		assert.Empty(t, added.Secret, "an import shows no secret")

		app, web, err := f.directory.Client(f.ctx, f.at(), ids["web"])
		require.NoError(t, err)
		require.NoError(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, web, "from-v4"))

		listed, err := f.apps.ListClientCredentials(f.ctx, f.projectID, created.App.ID, "web")
		require.NoError(t, err)
		require.Len(t, listed.Credentials, 2, "the initial secret and the import")
		for _, c := range listed.Credentials {
			assert.True(t, strings.HasPrefix(c.EncodedHash, "sha256:"), "credential %s still holds %q", c.Name, c.EncodedHash[:4])
		}
		require.NoError(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, web, "from-v4"))
	})

	t.Run("each credential is named, and revoked on its own", func(t *testing.T) {
		rotated, err := f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: created.App.ID, ClientSlug: "web", Name: "rotated",
		})
		require.NoError(t, err)
		require.NotEmpty(t, rotated.Secret)
		_, err = f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: created.App.ID, ClientSlug: "web", Name: "rotated",
		})
		require.ErrorIs(t, err, domain.ErrAppCredentialTaken(nil))

		require.NoError(t, f.apps.RevokeClientCredential(f.ctx, f.projectID, created.App.ID, "web", created.Secrets["web"].CredentialID))
		app, web, err := f.directory.Client(f.ctx, f.at(), ids["web"])
		require.NoError(t, err)
		require.ErrorIs(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, web, created.Secrets["web"].Secret), domain.ErrAppClientSecretInvalid(),
			"the revoked secret")
		require.NoError(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, web, rotated.Secret), "the client keeps its other secrets")
		require.ErrorIs(t, f.apps.RevokeClientCredential(f.ctx, f.projectID, created.App.ID, "web", created.Secrets["web"].CredentialID),
			domain.ErrAppCredentialNotFound())
	})

	t.Run("an expired credential no longer authenticates", func(t *testing.T) {
		past := time.Now().Add(-time.Minute)
		_, err := f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: created.App.ID, ClientSlug: "web", Name: "expired", Secret: "old-but-gold", ExpiresAt: &past,
		})
		require.NoError(t, err)
		app, web, err := f.directory.Client(f.ctx, f.at(), ids["web"])
		require.NoError(t, err)
		require.ErrorIs(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, web, "old-but-gold"), domain.ErrAppClientSecretInvalid())
	})

	t.Run("a client that brings its keys gets no secret; keys come from the document and the API", func(t *testing.T) {
		withKeys, err := f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(`{"slug":"jobs","name":"Jobs","clients":[
			{"slug":"runner","type":"confidential","grant_types":["client_credentials"],
			 "jwks":{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"file-1","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}]}}]}`))
		require.NoError(t, err)
		assert.Empty(t, withKeys.Secrets)
		key := []byte(`{"kty":"OKP","crv":"Ed25519","kid":"ci-1","x":"3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08"}`)
		added, err := f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: withKeys.App.ID, ClientSlug: "runner", Name: "ci", PublicKey: key,
		})
		require.NoError(t, err)
		assert.Equal(t, domain.CredentialKindKey, added.Credential.Kind)
		assert.Equal(t, "ci-1", added.Credential.KeyID)
		_, err = f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: withKeys.App.ID, ClientSlug: "runner", Name: "dup",
			PublicKey: []byte(`{"kty":"OKP","crv":"Ed25519","kid":"file-1","x":"3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08"}`),
		})
		require.ErrorIs(t, err, domain.ErrAppCredentialTaken(nil), "a kid the document already has")

		app, runner, err := f.directory.Client(f.ctx, f.at(), clientIDs(withKeys.AppView)["runner"])
		require.NoError(t, err)
		keys, err := f.directory.ClientKeys(f.ctx, f.at(), app, runner)
		require.NoError(t, err)
		require.Len(t, keys, 2)
		assert.Contains(t, string(keys[0]), `"kid":"file-1"`)
		assert.JSONEq(t, string(key), string(keys[1]))
	})

	t.Run("an import in the generated form must pass its checksum", func(t *testing.T) {
		_, err := f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: created.App.ID, ClientSlug: "web", Name: "fake", Secret: "zcs_not-generated",
		})
		require.ErrorIs(t, err, domain.ErrAppInvalid(nil))
	})

	t.Run("a public client holds no credential", func(t *testing.T) {
		_, err := f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: created.App.ID, ClientSlug: "desktop", Name: "nope",
		})
		require.ErrorIs(t, err, domain.ErrAppInvalid(nil))
	})
}

// portalDocument is a declared app; version 2 drops its admin client.
const portalDocument = `{
  "slug": "portal", "name": "Portal",
  "clients": [
    {"slug": "web", "type": "confidential", "secret": "${{ PORTAL_WEB_SECRET }}",
     "grant_types": ["authorization_code"], "redirect_uris": ["https://portal.example.com/cb"]},
    {"slug": "admin", "type": "public", "grant_types": ["authorization_code"],
     "redirect_uris": ["https://portal.example.com/admin/cb"]}
  ]
}`

const portalDocumentV2 = `{
  "slug": "portal", "name": "Portal",
  "clients": [
    {"slug": "web", "type": "confidential", "secret": "${{ PORTAL_WEB_SECRET }}",
     "grant_types": ["authorization_code"], "redirect_uris": ["https://portal.example.com/cb"]}
  ]
}`

func (f appFixture) build(t *testing.T, documents ...string) *domain.Release {
	t.Helper()
	input := service.BuildReleaseInput{ProjectID: f.projectID}
	for i, document := range documents {
		input.Apps = append(input.Apps, service.BuildApp{Index: i, Document: []byte(document)})
	}
	out, err := f.releases.Build(f.ctx, input)
	require.NoError(t, err)
	return out.Release
}

func (f appFixture) deploy(t *testing.T, release *domain.Release, origin string) string {
	t.Helper()
	deployment, err := domain.NewDeployment(f.projectID, release.ID, domain.DeploymentOriginKindPrimary, []string{origin}, domain.DeploymentMetadata{})
	require.NoError(t, err)
	require.NoError(t, f.pool.Statements().CreateDeployment(f.ctx, deployment, nil))
	return deployment.ID
}

func TestAppService_DeclaredApp(t *testing.T) {
	f := newAppFixture(t)

	v1 := f.build(t, portalDocument)
	require.Len(t, v1.Pointers, 1)
	assert.Equal(t, domain.ReleasePointerKindApp, v1.Pointers[0].Kind)
	assert.Equal(t, "portal", v1.Pointers[0].Handle)

	t.Run("an unchanged bundle reuses the revision and the release", func(t *testing.T) {
		again := f.build(t, portalDocument)
		assert.Equal(t, v1.ID, again.ID)
	})

	adminID := func() string {
		row, err := f.pool.Statements().ListAppClientIDs(f.ctx, f.projectID, mustAppID(t, f, "portal"))
		require.NoError(t, err)
		for _, r := range row {
			if r.Slug == "admin" {
				return r.ClientID
			}
		}
		t.Fatal("admin has no client id")
		return ""
	}()

	v2 := f.build(t, portalDocumentV2)
	require.NotEqual(t, v1.Pointers[0].RevisionID, v2.Pointers[0].RevisionID)
	old := service.AppLookup{ProjectID: f.projectID, DeploymentID: f.deploy(t, v1, "https://old.portal.example.com")}
	current := service.AppLookup{ProjectID: f.projectID, DeploymentID: f.deploy(t, v2, "https://portal.example.com")}

	t.Run("a deployment serves the revision its release pins", func(t *testing.T) {
		app, client, err := f.directory.Client(f.ctx, old, adminID)
		require.NoError(t, err, "the old release still lists admin")
		assert.Equal(t, v1.Pointers[0].RevisionID, app.RevisionID)
		assert.True(t, client.IsFirstParty(app.Source), "a declared app's client is first-party by default")

		_, _, err = f.directory.Client(f.ctx, current, adminID)
		require.ErrorIs(t, err, domain.ErrAppClientNotFound(), "the current release removed admin")
	})

	t.Run("the API may not write a declared app", func(t *testing.T) {
		_, err := f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(`{"slug":"portal","name":"Mine"}`))
		require.ErrorIs(t, err, domain.ErrAppDeclared())
	})

	t.Run("a release may not declare a registered app", func(t *testing.T) {
		_, err := f.apps.CreateOrRevise(f.ctx, f.projectID, []byte(`{"slug":"crm","name":"CRM"}`))
		require.NoError(t, err)
		_, err = f.releases.Build(f.ctx, service.BuildReleaseInput{ProjectID: f.projectID, Apps: []service.BuildApp{
			{Index: 0, Document: []byte(`{"slug":"crm","name":"CRM"}`)},
		}})
		var bundleErr *service.BundleValidationError
		require.ErrorAs(t, err, &bundleErr)
		require.Len(t, bundleErr.Resources, 1)
		assert.Equal(t, "crm", bundleErr.Resources[0].Handle)
	})

	t.Run("a declared client takes credentials through the API, and a deploy keeps them", func(t *testing.T) {
		const ci = `{"slug":"ci","name":"CI","clients":[{"slug":"deploy","type":"confidential","grant_types":["client_credentials"]}]}`
		f.build(t, ci)
		added, err := f.apps.AddClientCredential(f.ctx, service.AddAppClientCredentialInput{
			ProjectID: f.projectID, AppID: mustAppID(t, f, "ci"), ClientSlug: "deploy", Name: "github",
		})
		require.NoError(t, err)
		require.NotEmpty(t, added.Secret)

		f.build(t, strings.Replace(ci, `"name":"CI"`, `"name":"CI 2"`, 1))
		app, deploy, err := f.directory.Client(f.ctx, f.at(), added.ClientID)
		require.NoError(t, err)
		require.NoError(t, f.directory.VerifyClientSecret(f.ctx, f.at(), app, deploy, added.Secret),
			"the release revised the app, and the credential stays")
	})
}

func mustAppID(t *testing.T, f appFixture, slug string) string {
	t.Helper()
	list, err := f.apps.List(service.WithAuthzListUnrestricted(f.ctx), service.ListAppsInput{
		ProjectID: f.projectID,
		Filters:   []service.Filter{{Field: "slug", Operation: "equals", Value: slug}},
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)
	return list.Items[0].App.ID
}
