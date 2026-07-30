//go:build postgres_integration || spanner_integration

package stmttest

import (
	"crypto/rand"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// testPool is the migrated service.Pool for the dialect selected by TestMain.
var testPool service.Pool

func stmts() service.AllStatements {
	return testPool.Statements()
}

// uniqueSuffix builds a fixture suffix that is unique across calls.
// In the case of a time-based randomness, two calls within one test can read the same clock value and lead to flakiness.
func uniqueSuffix(t *testing.T) string {
	t.Helper()
	return strings.ReplaceAll(t.Name(), "/", "_") + "-" + rand.Text()
}

// uniqueProjectID returns a collision-free project ID scoped to the running
// (sub)test. The v2 statements commit immediately (no rollback), so isolation
// relies on unique IDs plus DeleteProjectByID cleanup rather than a transaction.
func uniqueProjectID(t *testing.T) string {
	t.Helper()
	return "proj-" + uniqueSuffix(t)
}

// newTestProject builds a persistable project. PreviewOrigins is a non-nil empty
// slice because the projects table declares preview_origins NOT NULL.
func newTestProject(id string) *domain.Project {
	return &domain.Project{ID: id, Name: "project-" + rand.Text(), PreviewOrigins: []string{}}
}

// newTestTeam builds a persistable team.
func newTestTeam(projectID, id string) *domain.Team {
	return &domain.Team{ProjectID: projectID, ID: id, Name: "team-" + rand.Text()}
}

func projectIDs(projects []*domain.Project) []string {
	ids := make([]string, len(projects))
	for i, p := range projects {
		ids[i] = p.ID
	}
	return ids
}
