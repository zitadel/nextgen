//go:build postgres_integration || spanner_integration

package repository_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestUserRepository_CreateGetListDelete(t *testing.T) {
	skipIfSpanner(t)
	repo := repository.NewUserRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-user-repo"
		tid       = "team-user-repo"
		schemaURL = "https://schemas.test/users/v1.json"
		userID    = "usr_aaa"
	)

	_, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (id) VALUES ($1)`, dbTable("projects")), pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (project_id, id) VALUES ($1,$2)`, dbTable("teams")), pid, tid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		fmt.Sprintf(`INSERT INTO %s (project_id, url, payload) VALUES ($1,$2,$3%s)`, dbTable("json_schemas"), jsonCast()),
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	attr1, err := domain.NewCreateAttribute("country", "CH", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	attr2, err := domain.NewCreateAttribute("nickname", "n1", domain.AttributeUniquenessTeam)
	require.NoError(t, err)
	attrEmptyArray, err := domain.NewCreateAttribute("emptyArray", []any{}, domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	attrEmptyObj, err := domain.NewCreateAttribute("emptyObj", map[string]any{}, domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)

	teamCopy := tid
	create := &domain.CreateUser{
		ProjectID:               pid,
		SchemaURL:               schemaURL,
		ID:                      userID,
		InitialMembershipTeamID: &teamCopy,
		Attributes:              []*domain.CreateAttribute{attr1, attr2, attrEmptyArray, attrEmptyObj},
	}
	require.NoError(t, repo.Create(ctx, tx, create))

	got, err := repo.Get(ctx, tx,
		database.WithCondition(repo.PrimaryKeyCondition(pid, userID)),
		repo.WithAttributes(),
	)
	require.NoError(t, err)
	require.Equal(t, pid, got.ProjectID)
	require.Equal(t, userID, got.ID)
	require.Equal(t, schemaURL, got.SchemaURL)
	require.True(t, got.IsSelfOwned())
	require.Equal(t, domain.UserStatusActive, got.Status)
	require.Len(t, got.Attributes, 4)

	membershipStatus := getTeamMembershipStatus(t, tx, pid, tid, userID)
	require.Equal(t, domain.MembershipStatusActive, membershipStatus)

	countryLit, err := json.Marshal("CH")
	require.NoError(t, err)
	users, err := repo.List(ctx, tx,
		repository.WithUserScalarList(pid, []repository.UserListScalarFilter{
			{Key: "country", Value: countryLit},
		}, nil),
		repo.WithAttributes("country"),
	)
	require.NoError(t, err)
	require.Len(t, users, 1)
	require.Len(t, users[0].Attributes, 1)
	require.Equal(t, "country", users[0].Attributes[0].Key)

	allByProject, err := repo.List(ctx, tx,
		database.WithCondition(repo.ProjectIDCondition(pid)),
	)
	require.NoError(t, err)
	require.Len(t, allByProject, 1)

	require.NoError(t, repo.Delete(ctx, tx, repo.PrimaryKeyCondition(pid, userID)))

	_, err = repo.Get(ctx, tx,
		database.WithCondition(repo.PrimaryKeyCondition(pid, userID)),
	)
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestUserRepository_CreateWithoutTeam(t *testing.T) {
	skipIfSpanner(t)
	repo := repository.NewUserRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-user-no-team"
		schemaURL = "https://schemas.test/users-no-team/v1.json"
		userID    = "usr_no_team"
	)

	_, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (id) VALUES ($1)`, dbTable("projects")), pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		fmt.Sprintf(`INSERT INTO %s (project_id, url, payload) VALUES ($1,$2,$3%s)`, dbTable("json_schemas"), jsonCast()),
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	plain, err := domain.NewCreateAttribute("country", "CH", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	unique, err := domain.NewCreateAttribute("nickname", "n1", domain.AttributeUniquenessTeam)
	require.NoError(t, err)

	require.NoError(t, repo.Create(ctx, tx, &domain.CreateUser{
		ProjectID:  pid,
		SchemaURL:  schemaURL,
		ID:         userID,
		Attributes: []*domain.CreateAttribute{plain, unique},
	}))

	got, err := repo.Get(ctx, tx,
		database.WithCondition(repo.PrimaryKeyCondition(pid, userID)),
		repo.WithAttributes(),
	)
	require.NoError(t, err)
	require.Equal(t, userID, got.ID)
	require.True(t, got.IsSelfOwned())
	require.Len(t, got.Attributes, 2)
}

func TestUserRepository_AttributesCondition(t *testing.T) {
	skipIfSpanner(t)
	repo := repository.NewUserRepository()
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-attr-cond"
		tid       = "team-attr-cond"
		schemaURL = "https://schemas.test/users-attr-cond/v1.json"
	)

	_, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (id) VALUES ($1)`, dbTable("projects")), pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (project_id, id) VALUES ($1,$2)`, dbTable("teams")), pid, tid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		fmt.Sprintf(`INSERT INTO %s (project_id, url, payload) VALUES ($1,$2,$3%s)`, dbTable("json_schemas"), jsonCast()),
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	mkUser := func(id, country, nickname string) {
		t.Helper()
		a1, err := domain.NewCreateAttribute("country", country, domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		a2, err := domain.NewCreateAttribute("nickname", nickname, domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		teamCopy := tid
		require.NoError(t, repo.Create(ctx, tx, &domain.CreateUser{
			ProjectID:               pid,
			SchemaURL:               schemaURL,
			ID:                      id,
			InitialMembershipTeamID: &teamCopy,
			Attributes:              []*domain.CreateAttribute{a1, a2},
		}))
	}
	mkUser("u1", "CH", "alice")
	mkUser("u2", "CH", "bob")
	mkUser("u3", "DE", "charlie")

	// 1) Get by a single attribute that pinpoints one user; also confirms attributes are hydrated.
	got, err := repo.Get(ctx, tx,
		database.WithCondition(database.And(
			repo.ProjectIDCondition(pid),
			repo.AttributesCondition([]domain.Attribute{{Key: "nickname", Value: "bob"}}),
		)),
		repo.WithAttributes(),
	)
	require.NoError(t, err)
	require.Equal(t, "u2", got.ID)
	require.Len(t, got.Attributes, 2)

	// 2) List by a single attribute matching multiple users.
	users, err := repo.List(ctx, tx,
		database.WithCondition(database.And(
			repo.ProjectIDCondition(pid),
			repo.AttributesCondition([]domain.Attribute{{Key: "country", Value: "CH"}}),
		)),
	)
	require.NoError(t, err)
	gotIDs := make([]string, 0, len(users))
	for _, u := range users {
		gotIDs = append(gotIDs, u.ID)
	}
	require.ElementsMatch(t, []string{"u1", "u2"}, gotIDs)

	// 3) List with two ANDed attributes resolves to a single user.
	users, err = repo.List(ctx, tx,
		database.WithCondition(database.And(
			repo.ProjectIDCondition(pid),
			repo.AttributesCondition([]domain.Attribute{
				{Key: "country", Value: "CH"},
				{Key: "nickname", Value: "alice"},
			}),
		)),
	)
	require.NoError(t, err)
	require.Len(t, users, 1)
	require.Equal(t, "u1", users[0].ID)

	// 4) Non-matching value yields empty result.
	users, err = repo.List(ctx, tx,
		database.WithCondition(database.And(
			repo.ProjectIDCondition(pid),
			repo.AttributesCondition([]domain.Attribute{{Key: "country", Value: "ZZ"}}),
		)),
	)
	require.NoError(t, err)
	require.Empty(t, users)

	// 5) Empty attribute slice acts as the AND identity (no narrowing).
	users, err = repo.List(ctx, tx,
		database.WithCondition(database.And(
			repo.ProjectIDCondition(pid),
			repo.AttributesCondition(nil),
		)),
	)
	require.NoError(t, err)
	require.Len(t, users, 3)
}
