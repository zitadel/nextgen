package service_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/passwap/argon2"
	"github.com/zitadel/passwap/bcrypt"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedProjectHashers(t *testing.T) (service.ProjectHasherResolver, *servicemocks.MockAllStatements) {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	return service.NewProjectHasherResolver(service.NewPool(pool), testHasherFactory(t)), stmts
}

func TestProjectHasherResolver(t *testing.T) {
	t.Parallel()

	// testHasherFactory hashes with bcrypt by default, so a project that made no
	// choice writes bcrypt and one that chose argon2id writes argon2 -- the
	// prefixes are what tell the two apart.
	t.Run("a project with no policy hashes with the deployment default", func(t *testing.T) {
		t.Parallel()

		hashers, stmts := newMockedProjectHashers(t)
		stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").
			Return(&domain.Project{ID: "proj_1"}, nil)

		hasher, err := hashers.HasherForProject(t.Context(), "proj_1")
		require.NoError(t, err)
		encoded, err := hasher.Hash("Passw0rd!")
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(encoded, bcrypt.Prefix), "got %q", encoded)
	})

	t.Run("a project with a policy hashes with it", func(t *testing.T) {
		t.Parallel()

		policy, err := domain.NewPasswordHashPolicy("argon2id", map[string]any{
			"time": 1, "memory": 32 * 1024, "threads": 1,
		})
		require.NoError(t, err)

		hashers, stmts := newMockedProjectHashers(t)
		stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").
			Return(&domain.Project{ID: "proj_1", PasswordHashPolicy: policy}, nil)

		hasher, err := hashers.HasherForProject(t.Context(), "proj_1")
		require.NoError(t, err)
		encoded, err := hasher.Hash("Passw0rd!")
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(encoded, argon2.Prefix), "got %q", encoded)
	})

	// A stored policy carries JSON numbers, because that is what came back out
	// of the column. The hasher has to take them as readily as the ints the
	// request arrived with, or a policy would work until the first restart.
	t.Run("takes a policy whose numbers came back through JSON", func(t *testing.T) {
		t.Parallel()

		hashers, stmts := newMockedProjectHashers(t)
		stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{
			ID: "proj_1",
			PasswordHashPolicy: &domain.PasswordHashPolicy{
				Algorithm: crypto.HashNameArgon2id,
				Params: map[string]any{
					"time": float64(1), "memory": float64(32 * 1024), "threads": float64(1),
				},
			},
		}, nil)

		hasher, err := hashers.HasherForProject(t.Context(), "proj_1")
		require.NoError(t, err)
		encoded, err := hasher.Hash("Passw0rd!")
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(encoded, argon2.Prefix), "got %q", encoded)
	})

	// The write this hash is for is about to fail on its own foreign key with an
	// error that names the real problem, so the resolver does not race it to a
	// worse one.
	t.Run("answers with the default for a project that is gone", func(t *testing.T) {
		t.Parallel()

		hashers, stmts := newMockedProjectHashers(t)
		stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_gone").
			Return(nil, database.NewNoRowFoundError(nil))

		hasher, err := hashers.HasherForProject(t.Context(), "proj_gone")
		require.NoError(t, err)
		encoded, err := hasher.Hash("Passw0rd!")
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(encoded, bcrypt.Prefix), "got %q", encoded)
	})

	t.Run("does not read storage without a project", func(t *testing.T) {
		t.Parallel()

		// No EXPECT on GetProjectByID: there is no project to resolve a policy
		// for, and the mock fails the test if one is asked for anyway.
		hashers, _ := newMockedProjectHashers(t)

		hasher, err := hashers.HasherForProject(t.Context(), "")
		require.NoError(t, err)
		require.NotNil(t, hasher)
	})

	t.Run("reports a storage failure", func(t *testing.T) {
		t.Parallel()

		hashers, stmts := newMockedProjectHashers(t)
		stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(nil, assert.AnError)

		_, err := hashers.HasherForProject(t.Context(), "proj_1")
		require.Error(t, err)
		assert.ErrorIs(t, err, assert.AnError)
	})

	// A policy is checked when it is written, so a stored one this deployment
	// cannot build means the deployment changed under it. Refusing is the safe
	// half: hashing with the default instead would quietly write a method the
	// project rejected.
	t.Run("refuses a policy this deployment can no longer build", func(t *testing.T) {
		t.Parallel()

		hashers, stmts := newMockedProjectHashers(t)
		stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{
			ID: "proj_1",
			PasswordHashPolicy: &domain.PasswordHashPolicy{
				Algorithm: crypto.HashName("no-such-algorithm"),
			},
		}, nil)

		_, err := hashers.HasherForProject(t.Context(), "proj_1")
		require.Error(t, err)
	})
}

func TestFixedProjectHasherResolver(t *testing.T) {
	t.Parallel()

	hasher := testHasherFactory(t).Default()
	resolver := service.FixedProjectHasherResolver{Hasher: hasher}

	for _, projectID := range []string{"", "proj_1", "proj_2"} {
		got, err := resolver.HasherForProject(t.Context(), projectID)
		require.NoError(t, err)
		assert.Same(t, hasher, got)
	}
}
