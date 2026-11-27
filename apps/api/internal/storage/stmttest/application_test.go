//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestApplicationStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "shop-" + uniqueSuffix(t)
		generated := &domain.ApplicationClient{Slug: "web"}
		supplied := &domain.ApplicationClient{Slug: "api", ClientID: "shop-api-" + uniqueSuffix(t)}

		application := createApplication(t, d.stmts, projectID, slug, generated, supplied)

		assert.True(t, domain.PrefixApplication.Matches(application.ID), "id %q is not app_-prefixed", application.ID)
		assert.True(t, domain.PrefixApplicationRevision.Matches(application.RevisionID), "revision id %q is not apprev_-prefixed", application.RevisionID)
		assert.WithinDuration(t, time.Now(), application.CreatedAt, 5*time.Second)
		assert.True(t, application.CreatedAt.Equal(application.UpdatedAt), "an application that was never revised must not look edited")

		// ADR 047 §5: a client without a client_id gets a copy of its key.
		assert.True(t, domain.PrefixApplicationClient.Matches(generated.ID))
		assert.Equal(t, generated.ID, generated.ClientID)
		assert.True(t, domain.PrefixApplicationClient.Matches(supplied.ID))
		assert.NotEqual(t, supplied.ID, supplied.ClientID)

		scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindApplication, projectID, application.ID)
		require.NoError(t, err)
		assert.Equal(t, projectID, scope.ProjectID)

		byID, err := d.stmts.GetApplication(t.Context(), applicationByID(projectID, application.ID))
		require.NoError(t, err)
		assert.Equal(t, slug, byID.Slug)
		assert.Equal(t, application.RevisionID, byID.RevisionID)
		assert.JSONEq(t, string(application.Document), string(byID.Document))
		assert.JSONEq(t, string(applicationDocument(slug, generated, supplied)), string(byID.Document), "the stored document holds the generated client_id")
		assert.True(t, byID.UpdatedAt.Equal(application.UpdatedAt), "create must report the timestamp a read serves")

		bySlug, err := d.stmts.GetApplication(t.Context(), applicationBySlug(projectID, slug))
		require.NoError(t, err)
		assert.Equal(t, application.ID, bySlug.ID)

		clients, err := d.stmts.ListApplicationClients(t.Context(), projectID, application.ID)
		require.NoError(t, err)
		assert.Equal(t, []*domain.ApplicationClient{supplied, generated}, clients, "ordered by slug")

		first := &domain.ApplicationClientSecret{ProjectID: projectID, ApplicationClientID: generated.ID, SecretHash: domain.HashSecret("one")}
		require.NoError(t, d.stmts.CreateApplicationClientSecret(t.Context(), first))
		assert.True(t, domain.PrefixApplicationClientSecret.Matches(first.ID), "id %q is not csec_-prefixed", first.ID)
		assert.WithinDuration(t, time.Now(), first.CreatedAt, 5*time.Second)
		second := &domain.ApplicationClientSecret{ProjectID: projectID, ApplicationClientID: generated.ID, SecretHash: domain.HashSecret("two")}
		require.NoError(t, d.stmts.CreateApplicationClientSecret(t.Context(), second))

		secrets, err := d.stmts.ListApplicationClientSecrets(t.Context(), projectID, generated.ID)
		require.NoError(t, err)
		assert.Equal(t, []*domain.ApplicationClientSecret{first, second}, secrets, "a client can hold more than one secret, oldest first")
		secrets, err = d.stmts.ListApplicationClientSecrets(t.Context(), projectID, supplied.ID)
		require.NoError(t, err)
		assert.Empty(t, secrets)
	})
}

func TestApplicationStatements_SlugUniquePerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "shop-" + uniqueSuffix(t)
		createApplication(t, d.stmts, projectID, slug)

		dup := &domain.Application{ProjectID: projectID, Slug: slug, Document: applicationDocument(slug)}
		assert.ErrorIs(t, d.stmts.CreateApplication(t.Context(), dup, nil), new(database.UniqueError))
	})
}

// A client_id is unique per project, across applications. The service tells
// client_id_taken from other unique errors by reading the holder afterwards.
func TestApplicationStatements_ClientIDUniquePerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		clientID := "shared-" + uniqueSuffix(t)
		holder := &domain.ApplicationClient{Slug: "web", ClientID: clientID}
		owner := createApplication(t, d.stmts, projectID, "shop-"+uniqueSuffix(t), holder)

		second := &domain.Application{ProjectID: projectID, Slug: "blog-" + uniqueSuffix(t), Document: applicationDocument("blog")}
		err := d.stmts.CreateApplication(t.Context(), second, []*domain.ApplicationClient{
			{Slug: "web", ClientID: clientID},
		})
		require.ErrorIs(t, err, new(database.UniqueError))

		// The failed create left no application behind.
		_, err = d.stmts.GetApplication(t.Context(), applicationBySlug(projectID, second.Slug))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		got, err := d.stmts.GetApplicationClientByClientID(t.Context(), projectID, clientID)
		require.NoError(t, err)
		assert.Equal(t, owner.ID, got.ApplicationID)
		assert.Equal(t, holder.ID, got.ID)

		_, err = d.stmts.GetApplicationClientByClientID(t.Context(), projectID, clientID+"-nope")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestApplicationStatements_ReviseAddsClients(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "shop-" + uniqueSuffix(t)
		web := &domain.ApplicationClient{Slug: "web"}
		application := createApplication(t, d.stmts, projectID, slug, web)
		firstRevisionID := application.RevisionID

		// The revision leaves web's client_id out, which the contract allows.
		api := &domain.ApplicationClient{Slug: "api"}
		application.Document = applicationDocument(slug, &domain.ApplicationClient{Slug: "web"}, api)
		require.NoError(t, d.stmts.ReviseApplication(t.Context(), application, []*domain.ApplicationClient{api}))
		assert.NotEqual(t, firstRevisionID, application.RevisionID)
		assert.True(t, domain.PrefixApplicationRevision.Matches(application.RevisionID))
		assert.True(t, application.UpdatedAt.After(application.CreatedAt))
		assert.True(t, api.CreatedAt.Equal(application.UpdatedAt), "a client takes the stamp of the revision that adds it")

		got, err := d.stmts.GetApplication(t.Context(), applicationByID(projectID, application.ID))
		require.NoError(t, err)
		assert.Equal(t, application.RevisionID, got.RevisionID)
		assert.JSONEq(t, string(application.Document), string(got.Document))
		assert.JSONEq(t, string(applicationDocument(slug, web, api)), string(got.Document), "the stored document holds the stored and the generated client_id")

		clients, err := d.stmts.ListApplicationClients(t.Context(), projectID, application.ID)
		require.NoError(t, err)
		assert.Equal(t, []*domain.ApplicationClient{api, web}, clients)

		// A revise that trips the client_id index rolls back whole: the
		// revision insert before it does not survive.
		holder := &domain.ApplicationClient{Slug: "web", ClientID: "held-" + uniqueSuffix(t)}
		createApplication(t, d.stmts, projectID, "blog-"+uniqueSuffix(t), holder)
		revised := application.RevisionID
		err = d.stmts.ReviseApplication(t.Context(), application, []*domain.ApplicationClient{
			{Slug: "worker", ClientID: holder.ClientID},
		})
		require.ErrorIs(t, err, new(database.UniqueError))
		assert.Equal(t, revised, application.RevisionID, "a failed revise must not move the entity to a rolled-back revision")

		got, err = d.stmts.GetApplication(t.Context(), applicationByID(projectID, application.ID))
		require.NoError(t, err)
		assert.Equal(t, revised, got.RevisionID)
	})
}

func TestApplicationStatements_DeclaredAndPinnedRevisions(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		registered := createApplication(t, d.stmts, projectID, "crm-"+uniqueSuffix(t), &domain.ApplicationClient{Slug: "web"})
		slug := "shop-" + uniqueSuffix(t)
		web := &domain.ApplicationClient{Slug: "web", ClientID: "shop-web-" + uniqueSuffix(t)}
		declared := &domain.Application{ProjectID: projectID, Slug: slug, IsDeclared: true, Document: applicationDocument(slug, web)}
		require.NoError(t, d.stmts.CreateApplication(t.Context(), declared, []*domain.ApplicationClient{web}))
		first := *declared

		got, err := d.stmts.GetApplication(t.Context(), applicationByID(projectID, registered.ID))
		require.NoError(t, err)
		assert.False(t, got.IsDeclared)
		got, err = d.stmts.GetApplication(t.Context(), applicationByID(projectID, declared.ID))
		require.NoError(t, err)
		assert.True(t, got.IsDeclared)

		api := &domain.ApplicationClient{Slug: "api", ClientID: "shop-api-" + uniqueSuffix(t)}
		declared.Document = applicationDocument(slug, web, api)
		require.NoError(t, d.stmts.ReviseApplication(t.Context(), declared, []*domain.ApplicationClient{api}))

		// A release keeps serving the revision it pins after a newer one.
		pinned, err := d.stmts.GetApplicationRevision(t.Context(), projectID, first.RevisionID)
		require.NoError(t, err)
		assert.Equal(t, declared.ID, pinned.ID)
		assert.Equal(t, slug, pinned.Slug)
		assert.True(t, pinned.IsDeclared)
		assert.Equal(t, first.RevisionID, pinned.RevisionID)
		assert.True(t, pinned.UpdatedAt.Equal(first.UpdatedAt))
		assert.JSONEq(t, string(applicationDocument(slug, web)), string(pinned.Document))

		newest, err := d.stmts.GetApplicationRevision(t.Context(), projectID, declared.RevisionID)
		require.NoError(t, err)
		assert.JSONEq(t, string(applicationDocument(slug, web, api)), string(newest.Document))

		_, err = d.stmts.GetApplicationRevision(t.Context(), projectID, "apprev_unknown")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetApplicationRevision(t.Context(), ensureProject(t, d.stmts), first.RevisionID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "a revision is read only in its own project")
	})
}

func TestApplicationStatements_ListRevisionsNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		slug := "shop-" + uniqueSuffix(t)
		web := &domain.ApplicationClient{Slug: "web"}
		application := createApplication(t, d.stmts, projectID, slug, web)
		first := application.RevisionID
		api := &domain.ApplicationClient{Slug: "api"}
		application.Document = applicationDocument(slug, web, api)
		require.NoError(t, d.stmts.ReviseApplication(t.Context(), application, []*domain.ApplicationClient{api}))
		second := application.RevisionID
		application.Document = applicationDocument(slug, web)
		require.NoError(t, d.stmts.ReviseApplication(t.Context(), application, nil))
		third := application.RevisionID

		revisions, err := d.stmts.ListApplicationRevisions(t.Context(), projectID, application.ID, 10)
		require.NoError(t, err)
		ids := make([]string, len(revisions))
		for i, revision := range revisions {
			ids[i] = revision.RevisionID
			assert.Equal(t, application.ID, revision.ID)
			assert.Equal(t, slug, revision.Slug)
		}
		assert.Equal(t, []string{third, second, first}, ids)
		assert.JSONEq(t, string(applicationDocument(slug, web, api)), string(revisions[1].Document))

		limited, err := d.stmts.ListApplicationRevisions(t.Context(), projectID, application.ID, 2)
		require.NoError(t, err)
		require.Len(t, limited, 2)
		assert.Equal(t, third, limited[0].RevisionID)
		assert.Equal(t, second, limited[1].RevisionID)

		missing, err := d.stmts.ListApplicationRevisions(t.Context(), projectID, "app_unknown", 10)
		require.NoError(t, err)
		assert.Empty(t, missing)
		crossProject, err := d.stmts.ListApplicationRevisions(t.Context(), ensureProject(t, d.stmts), application.ID, 10)
		require.NoError(t, err)
		assert.Empty(t, crossProject, "revisions are listed only in their own project")
	})
}

// The list returns declared and registered applications of one project, each
// once at its newest revision, and pages through them by cursor.
func TestApplicationStatements_List(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		web := &domain.ApplicationClient{Slug: "web"}
		registered := createApplication(t, d.stmts, projectID, "a-"+suffix, web)
		declared := &domain.Application{ProjectID: projectID, Slug: "b-" + suffix, IsDeclared: true, Document: applicationDocument("b-" + suffix)}
		require.NoError(t, d.stmts.CreateApplication(t.Context(), declared, nil))
		revised := createApplication(t, d.stmts, projectID, "c-"+suffix)
		revised.Document = applicationDocument(revised.Slug, web)
		require.NoError(t, d.stmts.ReviseApplication(t.Context(), revised, nil))
		createApplication(t, d.stmts, ensureProject(t, d.stmts), "other-"+suffix)

		list := func(t *testing.T, cursor []byte, limit uint32, filters ...database.Filter[domain.ApplicationField]) *database.ListResult[*domain.Application] {
			t.Helper()
			result, err := d.stmts.ListApplications(unfilteredListCtx(t), &database.ListOptions[domain.ApplicationField]{
				Filter: database.And(append(filters, database.Equal(database.Col(domain.ApplicationFieldProjectID), projectID))...),
				Pagination: database.Page[domain.ApplicationField]{
					Limit:  limit,
					Cursor: cursor,
					OrderBy: database.OrderBy[domain.ApplicationField]{
						Columns: []database.Column[domain.ApplicationField]{
							database.Col(domain.ApplicationFieldSlug),
							database.Col(domain.ApplicationFieldID),
						},
					},
				},
			})
			require.NoError(t, err)
			return result
		}

		all := list(t, nil, 10)
		require.Len(t, all.Items, 3)
		assert.Empty(t, all.NextCursor)
		assert.Equal(t, registered.ID, all.Items[0].ID)
		assert.False(t, all.Items[0].IsDeclared)
		assert.Equal(t, declared.ID, all.Items[1].ID)
		assert.True(t, all.Items[1].IsDeclared)
		assert.Equal(t, revised.ID, all.Items[2].ID)
		assert.Equal(t, revised.RevisionID, all.Items[2].RevisionID)
		assert.JSONEq(t, string(revised.Document), string(all.Items[2].Document))

		var paged []string
		var cursor []byte
		for {
			page := list(t, cursor, 2)
			for _, item := range page.Items {
				paged = append(paged, item.ID)
			}
			if cursor = page.NextCursor; len(cursor) == 0 {
				break
			}
		}
		assert.Equal(t, []string{registered.ID, declared.ID, revised.ID}, paged)

		bySlug := list(t, nil, 10, database.Equal(database.Col(domain.ApplicationFieldSlug), declared.Slug))
		require.Len(t, bySlug.Items, 1)
		assert.Equal(t, declared.ID, bySlug.Items[0].ID)
	})
}

// A secret variable name is claimed once per project, by one client.
func TestApplicationStatements_SecretVariableClaims(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		web := &domain.ApplicationClient{Slug: "web", ClientID: "shop-web-" + uniqueSuffix(t)}
		api := &domain.ApplicationClient{Slug: "api", ClientID: "shop-api-" + uniqueSuffix(t)}
		createApplication(t, d.stmts, projectID, "shop-"+uniqueSuffix(t), web, api)
		name := "SHOP_WEB_SECRET_" + uniqueSuffix(t)

		_, err := d.stmts.GetApplicationSecretVariable(t.Context(), projectID, name)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		claim := &domain.ApplicationSecretVariable{ProjectID: projectID, Name: name, ApplicationClientID: web.ID}
		require.NoError(t, d.stmts.CreateApplicationSecretVariable(t.Context(), claim))
		assert.WithinDuration(t, time.Now(), claim.CreatedAt, 5*time.Second)

		got, err := d.stmts.GetApplicationSecretVariable(t.Context(), projectID, name)
		require.NoError(t, err)
		assert.Equal(t, web.ID, got.ApplicationClientID)
		assert.Equal(t, name, got.Name)
		assert.True(t, got.CreatedAt.Equal(claim.CreatedAt))

		err = d.stmts.CreateApplicationSecretVariable(t.Context(), &domain.ApplicationSecretVariable{ProjectID: projectID, Name: name, ApplicationClientID: api.ID})
		assert.ErrorIs(t, err, new(database.UniqueError), "a name is one client's")

		err = d.stmts.CreateApplicationSecretVariable(t.Context(), &domain.ApplicationSecretVariable{ProjectID: projectID, Name: "OTHER_" + uniqueSuffix(t), ApplicationClientID: "appcl_unknown"})
		assert.ErrorIs(t, err, new(database.ForeignKeyError))

		_, err = d.stmts.GetApplicationSecretVariable(t.Context(), ensureProject(t, d.stmts), name)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "a claim is read only in its own project")

		_, err = d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)
		_, err = d.stmts.GetApplicationSecretVariable(t.Context(), projectID, name)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "a project delete cascades")
	})
}

func TestApplicationStatements_UnknownApplication(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		unknown := &domain.Application{ProjectID: projectID, ID: "app_unknown", Document: applicationDocument("x")}

		assert.ErrorIs(t, d.stmts.ReviseApplication(t.Context(), unknown, nil), new(database.NoRowFoundError))
		err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return tx.Statements().LockApplication(ctx, projectID, unknown.ID)
		})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetApplication(t.Context(), applicationByID(projectID, unknown.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		clients, err := d.stmts.ListApplicationClients(t.Context(), projectID, unknown.ID)
		require.NoError(t, err)
		assert.Empty(t, clients)

		err = d.stmts.CreateApplicationClientSecret(t.Context(), &domain.ApplicationClientSecret{ProjectID: projectID, ApplicationClientID: "client_unknown", SecretHash: domain.HashSecret("one")})
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
		secrets, err := d.stmts.ListApplicationClientSecrets(t.Context(), projectID, "client_unknown")
		require.NoError(t, err)
		assert.Empty(t, secrets)
	})
}

func TestApplicationStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		client := &domain.ApplicationClient{Slug: "web"}
		application := createApplication(t, d.stmts, projectID, "shop-"+uniqueSuffix(t), client)
		require.NoError(t, d.stmts.CreateApplicationClientSecret(t.Context(), &domain.ApplicationClientSecret{ProjectID: projectID, ApplicationClientID: client.ID, SecretHash: domain.HashSecret("one")}))
		now := time.Now().UTC()
		key := &domain.ApplicationIdempotencyKey{
			ProjectID:     projectID,
			KeyHash:       domain.HashSecret("key"),
			RequestHash:   domain.HashSecret("document"),
			ApplicationID: application.ID,
			ClientIDs:     []string{client.ID},
			CreatedAt:     now,
			ExpiresAt:     now.Add(time.Hour),
		}
		require.NoError(t, d.stmts.CreateApplicationIdempotencyKey(t.Context(), key))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetApplication(t.Context(), applicationByID(projectID, application.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetApplicationClientByClientID(t.Context(), projectID, client.ClientID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		secrets, err := d.stmts.ListApplicationClientSecrets(t.Context(), projectID, client.ID)
		require.NoError(t, err)
		assert.Empty(t, secrets)
		_, err = d.stmts.GetApplicationIdempotencyKey(t.Context(), projectID, key.KeyHash, now)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestApplicationStatements_IdempotencyKeys(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		web, admin := &domain.ApplicationClient{Slug: "web"}, &domain.ApplicationClient{Slug: "admin"}
		application := createApplication(t, d.stmts, projectID, "shop-"+uniqueSuffix(t), web, admin)
		now := time.Now().UTC().Truncate(time.Microsecond)
		newKey := func(projectID, keyHash string, createdAt, expiresAt time.Time) *domain.ApplicationIdempotencyKey {
			return &domain.ApplicationIdempotencyKey{
				ProjectID:     projectID,
				KeyHash:       keyHash,
				RequestHash:   domain.HashSecret("document"),
				ApplicationID: application.ID,
				Created:       true,
				ClientIDs:     []string{web.ID, admin.ID},
				CreatedAt:     createdAt,
				ExpiresAt:     expiresAt,
			}
		}

		t.Run("a record round trips with its client ids in order", func(t *testing.T) {
			key := newKey(projectID, domain.HashSecret("round-trip"), now, now.Add(time.Hour))
			require.NoError(t, d.stmts.CreateApplicationIdempotencyKey(t.Context(), key))

			got, err := d.stmts.GetApplicationIdempotencyKey(t.Context(), projectID, key.KeyHash, now)
			require.NoError(t, err)
			assert.Equal(t, key.RequestHash, got.RequestHash)
			assert.Equal(t, application.ID, got.ApplicationID)
			assert.True(t, got.Created)
			assert.Equal(t, []string{web.ID, admin.ID}, got.ClientIDs)
			assert.True(t, got.CreatedAt.Equal(now))
			assert.True(t, got.ExpiresAt.Equal(key.ExpiresAt))

			again := newKey(projectID, key.KeyHash, now, now.Add(time.Hour))
			assert.ErrorIs(t, d.stmts.CreateApplicationIdempotencyKey(t.Context(), again), new(database.UniqueError), "a live record is not replaced")
		})

		t.Run("an expired record is not returned and a create replaces it", func(t *testing.T) {
			keyHash := domain.HashSecret("expired")
			expiresAt := now.Add(-time.Minute)
			require.NoError(t, d.stmts.CreateApplicationIdempotencyKey(t.Context(), newKey(projectID, keyHash, expiresAt.Add(-time.Hour), expiresAt)))

			_, err := d.stmts.GetApplicationIdempotencyKey(t.Context(), projectID, keyHash, expiresAt)
			assert.ErrorIs(t, err, new(database.NoRowFoundError), "a record has expired at its expires_at")

			fresh := newKey(projectID, keyHash, expiresAt, now.Add(time.Hour))
			fresh.Created, fresh.ClientIDs = false, nil
			require.NoError(t, d.stmts.CreateApplicationIdempotencyKey(t.Context(), fresh), "a create at the old record's expires_at replaces it")
			got, err := d.stmts.GetApplicationIdempotencyKey(t.Context(), projectID, keyHash, expiresAt)
			require.NoError(t, err)
			assert.False(t, got.Created)
			assert.Empty(t, got.ClientIDs)
		})

		t.Run("the same key in another project is its own record", func(t *testing.T) {
			keyHash := domain.HashSecret("shared")
			require.NoError(t, d.stmts.CreateApplicationIdempotencyKey(t.Context(), newKey(projectID, keyHash, now, now.Add(time.Hour))))

			other := ensureProject(t, d.stmts)
			_, err := d.stmts.GetApplicationIdempotencyKey(t.Context(), other, keyHash, now)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
			otherApp := createApplication(t, d.stmts, other, "shop-"+uniqueSuffix(t))
			key := newKey(other, keyHash, now, now.Add(time.Hour))
			key.ApplicationID, key.ClientIDs = otherApp.ID, nil
			require.NoError(t, d.stmts.CreateApplicationIdempotencyKey(t.Context(), key))
		})

		t.Run("deleting a client's secrets leaves the other client's", func(t *testing.T) {
			for _, client := range []*domain.ApplicationClient{web, web, admin} {
				require.NoError(t, d.stmts.CreateApplicationClientSecret(t.Context(), &domain.ApplicationClientSecret{ProjectID: projectID, ApplicationClientID: client.ID, SecretHash: domain.HashSecret(client.Slug)}))
			}

			require.NoError(t, d.stmts.DeleteApplicationClientSecrets(t.Context(), projectID, web.ID))
			secrets, err := d.stmts.ListApplicationClientSecrets(t.Context(), projectID, web.ID)
			require.NoError(t, err)
			assert.Empty(t, secrets)
			secrets, err = d.stmts.ListApplicationClientSecrets(t.Context(), projectID, admin.ID)
			require.NoError(t, err)
			assert.Len(t, secrets, 1)
			require.NoError(t, d.stmts.DeleteApplicationClientSecrets(t.Context(), projectID, web.ID), "a client without secrets is no error")
		})
	})
}

// applicationDocument lists clients by slug, each with the client_id it has.
// The type field stands for the fields storage does not model.
func applicationDocument(slug string, clients ...*domain.ApplicationClient) []byte {
	docClients := make([]map[string]any, 0, len(clients))
	for _, client := range clients {
		docClient := map[string]any{"slug": client.Slug, "type": "web"}
		if client.ClientID != "" {
			docClient["client_id"] = client.ClientID
		}
		docClients = append(docClients, docClient)
	}
	document, _ := json.Marshal(map[string]any{"slug": slug, "name": "Shop", "clients": docClients})
	return document
}

func applicationByID(projectID, id string) database.Filter[domain.ApplicationField] {
	return database.And(
		database.Equal(database.Col(domain.ApplicationFieldProjectID), projectID),
		database.Equal(database.Col(domain.ApplicationFieldID), id),
	)
}

func applicationBySlug(projectID, slug string) database.Filter[domain.ApplicationField] {
	return database.And(
		database.Equal(database.Col(domain.ApplicationFieldProjectID), projectID),
		database.Equal(database.Col(domain.ApplicationFieldSlug), slug),
	)
}

func createApplication(t *testing.T, stmts service.ApplicationStatements, projectID, slug string, clients ...*domain.ApplicationClient) *domain.Application {
	t.Helper()
	application := &domain.Application{ProjectID: projectID, Slug: slug, Document: applicationDocument(slug, clients...)}
	require.NoError(t, stmts.CreateApplication(t.Context(), application, clients))
	return application
}
