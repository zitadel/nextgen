package sqlite_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/sqlite"
)

func TestZeroConfigStyleConnectMigrateCRUD(t *testing.T) {
	path := filepath.Join(t.TempDir(), "zitadel.db")
	dialect := sqlite.Config{Path: path}
	pool, err := dialect.Connect(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })
	require.NoError(t, pool.Migrate(t.Context()))

	p := pool.(*sqlite.Pool)
	project := &domain.Project{ID: "proj-smoke", Name: "Smoke", PreviewOrigins: []string{}}
	require.NoError(t, p.CreateProject(t.Context(), project))
	got, err := p.GetProjectByID(t.Context(), "proj-smoke")
	require.NoError(t, err)
	require.Equal(t, "Smoke", got.Name)

	team := &domain.Team{ProjectID: "proj-smoke", ID: "team-1", Name: "Admins"}
	require.NoError(t, p.CreateTeam(t.Context(), team))
	require.Equal(t, domain.TeamStatusActive, team.Status)
}
