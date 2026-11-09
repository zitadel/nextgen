//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
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
		generated := &domain.ApplicationClient{Slug: "web", SecretHash: domain.HashSecret("one")}
		supplied := &domain.ApplicationClient{Slug: "api", ClientID: "shop-api-" + uniqueSuffix(t), SecretHash: domain.HashSecret("two")}

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
		assert.True(t, byID.UpdatedAt.Equal(application.UpdatedAt), "create must report the timestamp a read serves")

		bySlug, err := d.stmts.GetApplication(t.Context(), applicationBySlug(projectID, slug))
		require.NoError(t, err)
		assert.Equal(t, application.ID, bySlug.ID)

		clients, err := d.stmts.ListApplicationClients(t.Context(), projectID, application.ID)
		require.NoError(t, err)
		assert.Equal(t, []*domain.ApplicationClient{supplied, generated}, clients, "ordered by slug")
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
		holder := &domain.ApplicationClient{Slug: "web", ClientID: clientID, SecretHash: domain.HashSecret("one")}
		owner := createApplication(t, d.stmts, projectID, "shop-"+uniqueSuffix(t), holder)

		second := &domain.Application{ProjectID: projectID, Slug: "blog-" + uniqueSuffix(t), Document: applicationDocument("blog")}
		err := d.stmts.CreateApplication(t.Context(), second, []*domain.ApplicationClient{
			{Slug: "web", ClientID: clientID, SecretHash: domain.HashSecret("two")},
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
		web := &domain.ApplicationClient{Slug: "web", SecretHash: domain.HashSecret("one")}
		application := createApplication(t, d.stmts, projectID, "shop-"+uniqueSuffix(t), web)
		firstRevisionID := application.RevisionID

		application.Document = []byte(`{"slug":"shop","name":"Shop 2","clients":[]}`)
		api := &domain.ApplicationClient{Slug: "api", SecretHash: domain.HashSecret("two")}
		require.NoError(t, d.stmts.ReviseApplication(t.Context(), application, []*domain.ApplicationClient{api}))
		assert.NotEqual(t, firstRevisionID, application.RevisionID)
		assert.True(t, domain.PrefixApplicationRevision.Matches(application.RevisionID))
		assert.True(t, application.UpdatedAt.After(application.CreatedAt))
		assert.True(t, api.CreatedAt.Equal(application.UpdatedAt), "a client takes the stamp of the revision that adds it")

		got, err := d.stmts.GetApplication(t.Context(), applicationByID(projectID, application.ID))
		require.NoError(t, err)
		assert.Equal(t, application.RevisionID, got.RevisionID)
		assert.JSONEq(t, string(application.Document), string(got.Document))

		clients, err := d.stmts.ListApplicationClients(t.Context(), projectID, application.ID)
		require.NoError(t, err)
		assert.Equal(t, []*domain.ApplicationClient{api, web}, clients)

		// A revise that trips the client_id index rolls back whole: the
		// revision insert before it does not survive.
		holder := &domain.ApplicationClient{Slug: "web", ClientID: "held-" + uniqueSuffix(t), SecretHash: domain.HashSecret("three")}
		createApplication(t, d.stmts, projectID, "blog-"+uniqueSuffix(t), holder)
		revised := application.RevisionID
		err = d.stmts.ReviseApplication(t.Context(), application, []*domain.ApplicationClient{
			{Slug: "worker", ClientID: holder.ClientID, SecretHash: domain.HashSecret("four")},
		})
		require.ErrorIs(t, err, new(database.UniqueError))
		assert.Equal(t, revised, application.RevisionID, "a failed revise must not move the entity to a rolled-back revision")

		got, err = d.stmts.GetApplication(t.Context(), applicationByID(projectID, application.ID))
		require.NoError(t, err)
		assert.Equal(t, revised, got.RevisionID)
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
	})
}

func TestApplicationStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		client := &domain.ApplicationClient{Slug: "web", SecretHash: domain.HashSecret("one")}
		application := createApplication(t, d.stmts, projectID, "shop-"+uniqueSuffix(t), client)

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetApplication(t.Context(), applicationByID(projectID, application.ID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetApplicationClientByClientID(t.Context(), projectID, client.ClientID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func applicationDocument(slug string) []byte {
	return []byte(`{"slug":"` + slug + `","name":"Shop","clients":[]}`)
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
	application := &domain.Application{ProjectID: projectID, Slug: slug, Document: applicationDocument(slug)}
	require.NoError(t, stmts.CreateApplication(t.Context(), application, clients))
	return application
}
