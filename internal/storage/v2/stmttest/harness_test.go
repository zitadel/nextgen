//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"crypto/rand"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

func uniqueSuffix(t *testing.T) string {
	t.Helper()
	return strings.ReplaceAll(t.Name(), "/", "_") + "-" + rand.Text()
}

func uniqueProjectID(t *testing.T) string {
	t.Helper()
	return "proj-" + uniqueSuffix(t)
}

func newTestProject(id string) *domain.Project {
	return &domain.Project{ID: id, Name: "project-" + rand.Text(), PreviewOrigins: []string{}}
}

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
