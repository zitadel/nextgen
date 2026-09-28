//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func idpIdentityLinkByPair(projectID, connectionID, subject string) database.Filter[domain.IDPIdentityLinkField] {
	return database.And(
		database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldConnectionID), connectionID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldSubject), subject),
	)
}

// createLinkUser stores a user a link can point at.
func createLinkUser(t *testing.T, stmts service.AllStatements, projectID, schemaURL, name string) string {
	t.Helper()
	user := newTestUser(t, projectID, schemaURL, "", name+"@example.com", name)
	require.NoError(t, stmts.CreateUser(t.Context(), user))
	return user.ID
}

// idpIdentityLinkFixture is one project holding one user and one connection.
type idpIdentityLinkFixture struct {
	projectID, schemaURL, userID, connectionID string
}

func newIDPIdentityLinkFixture(t *testing.T, stmts service.AllStatements) idpIdentityLinkFixture {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, stmts)
	return idpIdentityLinkFixture{
		projectID:    projectID,
		schemaURL:    schemaURL,
		userID:       createLinkUser(t, stmts, projectID, schemaURL, "linked"),
		connectionID: createIDPConnection(t, stmts, projectID, "google", idpConnectionDocument("https://accounts.example.com")).ID,
	}
}

func (f idpIdentityLinkFixture) link(subject string) *domain.IDPIdentityLink {
	return &domain.IDPIdentityLink{
		ProjectID:    f.projectID,
		ConnectionID: f.connectionID,
		Subject:      subject,
		UserID:       f.userID,
	}
}

func TestIDPIdentityLinkStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newIDPIdentityLinkFixture(t, d.stmts)

		link := f.link("subject-1")
		require.NoError(t, d.stmts.CreateIDPIdentityLink(t.Context(), link))
		assert.True(t, domain.PrefixIDPIdentityLink.Matches(link.ID), "id %q", link.ID)
		assert.False(t, link.CreatedAt.IsZero())
		assert.Equal(t, time.UTC, link.CreatedAt.Location())

		got, err := d.stmts.GetIDPIdentityLink(t.Context(), idpIdentityLinkByPair(f.projectID, f.connectionID, "subject-1"))
		require.NoError(t, err)
		assert.Equal(t, link.ProjectID, got.ProjectID)
		assert.Equal(t, link.ID, got.ID)
		assert.Equal(t, link.ConnectionID, got.ConnectionID)
		assert.Equal(t, link.Subject, got.Subject)
		assert.Equal(t, link.UserID, got.UserID)
		assert.True(t, link.CreatedAt.Equal(got.CreatedAt), "create returned %s, get %s", link.CreatedAt, got.CreatedAt)
		assert.Equal(t, time.UTC, got.CreatedAt.Location())
	})
}

// A subject on a connection resolves to one user, so a second link for the
// same pair must fail even when it names another user.
func TestIDPIdentityLinkStatements_PairUniquePerConnection(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newIDPIdentityLinkFixture(t, d.stmts)
		require.NoError(t, d.stmts.CreateIDPIdentityLink(t.Context(), f.link("subject-1")))

		second := f.link("subject-1")
		second.UserID = createLinkUser(t, d.stmts, f.projectID, f.schemaURL, "other")
		err := d.stmts.CreateIDPIdentityLink(t.Context(), second)
		assert.ErrorIs(t, err, new(database.UniqueError))
	})
}

func TestIDPIdentityLinkStatements_PairReusableAcrossProjectsAndConnections(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newIDPIdentityLinkFixture(t, d.stmts)
		require.NoError(t, d.stmts.CreateIDPIdentityLink(t.Context(), f.link("subject-1")))

		otherConnection := f.link("subject-1")
		otherConnection.ConnectionID = createIDPConnection(t, d.stmts, f.projectID, "github", idpConnectionDocument("https://github.example.com")).ID
		require.NoError(t, d.stmts.CreateIDPIdentityLink(t.Context(), otherConnection))

		// Connection ids are minted per row, so another project repeats the
		// subject on its own connection.
		other := newIDPIdentityLinkFixture(t, d.stmts)
		require.NoError(t, d.stmts.CreateIDPIdentityLink(t.Context(), other.link("subject-1")))
	})
}

func TestIDPIdentityLinkStatements_GetMissIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newIDPIdentityLinkFixture(t, d.stmts)
		require.NoError(t, d.stmts.CreateIDPIdentityLink(t.Context(), f.link("subject-1")))

		_, err := d.stmts.GetIDPIdentityLink(t.Context(), idpIdentityLinkByPair(f.projectID, f.connectionID, "subject-2"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		otherProject, _ := ensureUserTestProject(t, d.stmts)
		_, err = d.stmts.GetIDPIdentityLink(t.Context(), idpIdentityLinkByPair(otherProject, f.connectionID, "subject-1"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestIDPIdentityLinkStatements_UnknownUserOrConnectionIsForeignKey(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newIDPIdentityLinkFixture(t, d.stmts)

		unknownUser := f.link("subject-1")
		unknownUser.UserID = domain.PrefixUser.IDPrefix("does_not_exist")
		assert.ErrorIs(t, d.stmts.CreateIDPIdentityLink(t.Context(), unknownUser), new(database.ForeignKeyError))

		unknownConnection := f.link("subject-1")
		unknownConnection.ConnectionID = domain.PrefixIDPConnection.IDPrefix("does_not_exist")
		assert.ErrorIs(t, d.stmts.CreateIDPIdentityLink(t.Context(), unknownConnection), new(database.ForeignKeyError))
	})
}

// Links are provisioning metadata of the user, so they go when the user goes.
// The connection is not the user's and must stay.
func TestIDPIdentityLinkStatements_UserDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newIDPIdentityLinkFixture(t, d.stmts)
		require.NoError(t, d.stmts.CreateIDPIdentityLink(t.Context(), f.link("subject-1")))

		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), f.projectID, f.userID))

		_, err := d.stmts.GetIDPIdentityLink(t.Context(), idpIdentityLinkByPair(f.projectID, f.connectionID, "subject-1"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPConnection(t.Context(), idpConnectionByID(f.projectID, f.connectionID))
		assert.NoError(t, err)
	})
}

// The engine creates a user from claims and links it in one transaction, so a
// failure after both inserts must leave neither: a user without its link could
// never sign in through the provider again.
func TestIDPIdentityLinkStatements_LinkCommitsWithTheUser(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		connectionID := createIDPConnection(t, d.stmts, projectID, "google", idpConnectionDocument("https://accounts.example.com")).ID

		user := newTestUser(t, projectID, schemaURL, "", "rolled-back@example.com", "rolled-back")
		errRollback := errors.New("roll back")
		err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			// A retry replays the closure, so the user id is minted afresh
			// each attempt.
			user.ID = ""
			if err := tx.Statements().CreateUser(ctx, user); err != nil {
				return err
			}
			if err := tx.Statements().CreateIDPIdentityLink(ctx, &domain.IDPIdentityLink{
				ProjectID:    projectID,
				ConnectionID: connectionID,
				Subject:      "subject-1",
				UserID:       user.ID,
			}); err != nil {
				return err
			}
			return errRollback
		})
		require.ErrorIs(t, err, errRollback, "both inserts must succeed inside the transaction")

		_, err = d.stmts.GetUser(t.Context(),
			database.And(
				database.Equal(database.Col(domain.UserFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserFieldID), user.ID),
			),
			service.UserQueryOptions{},
		)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.GetIDPIdentityLink(t.Context(), idpIdentityLinkByPair(projectID, connectionID, "subject-1"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
