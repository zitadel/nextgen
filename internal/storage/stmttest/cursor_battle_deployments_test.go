//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"fmt"
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/preview"
)

// seedDeployments writes five deployments, one per origin from originOf, in
// order. Each is stamped after the one before, so insertion order is the
// ascending keyset order.
func seedDeployments(t *testing.T, d dialect, projectID string, originOf func(int) string) []string {
	t.Helper()
	want := make([]string, 0, 5)
	for i := range 5 {
		rel := createRelease(t, d.stmts, projectID, string(rune('a'+i)), domain.ReleaseMetadata{})
		dep := deploy(t, d.stmts, projectID, rel.ID, []string{originOf(i)}, deployArgs{})
		want = append(want, dep.ID)
	}
	return want
}

func distinctOrigin(i int) string { return fmt.Sprintf("https://app%d.acme.com", i) }

func battleDeployments(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureReleaseProject(t, d.stmts)
	want := seedDeployments(t, d, projectID, distinctOrigin)
	filter := database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID)
	orderAsc := deployment.NewestFirst()
	orderAsc.Direction = database.OrderAsc
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
		return d.stmts.ListDeployments(unfilteredListCtx(t), &database.ListOptions[domain.DeploymentField]{
			Filter: filter, Pagination: page,
		})
	}, func(e *domain.Deployment) string { return e.ID }, 2)
}

// One origin's history pages through the correlated origin predicate.
func battleDeploymentsOfOrigin(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureReleaseProject(t, d.stmts)
	want := seedDeployments(t, d, projectID, func(int) string { return appOrigin })
	orderAsc := deployment.NewestFirst()
	orderAsc.Direction = database.OrderAsc
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
		opts := deployment.ListOptions(projectID, new(appOrigin), page.Limit)
		opts.Pagination = page
		return d.stmts.ListDeployments(unfilteredListCtx(t), opts)
	}, func(e *domain.Deployment) string { return e.ID }, 2)
}

// The live view pages through the correlated live predicate; every seeded
// deployment serves its own origin.
func battleLiveDeployments(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureReleaseProject(t, d.stmts)
	want := seedDeployments(t, d, projectID, distinctOrigin)
	now := time.Now()
	orderAsc := deployment.NewestFirst()
	orderAsc.Direction = database.OrderAsc
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
		opts := deployment.LiveListOptions(projectID, now, deployment.LiveFilter{}, page.Limit)
		opts.Pagination = page
		return d.stmts.ListLiveDeployments(unfilteredListCtx(t), now, opts)
	}, func(e *domain.Deployment) string { return e.ID }, 2)
}

func battlePreviews(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureReleaseProject(t, d.stmts)
	rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
	want := make([]string, 0, 5)
	for i := range 5 {
		origin := fmt.Sprintf("https://acme-%d-acmeinc.vercel.app", i)
		deploy(t, d.stmts, projectID, rel.ID, []string{origin}, previewDeploy(time.Hour))
		want = append(want, origin)
	}
	now := time.Now()
	live := preview.LiveListOptions(projectID, now, 0)
	orderAsc := live.Pagination.OrderBy
	orderAsc.Direction = database.OrderAsc
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.PreviewField]) (*database.ListResult[*domain.Preview], error) {
		return d.stmts.ListPreviews(t.Context(), &database.ListOptions[domain.PreviewField]{
			Filter: live.Filter, Pagination: page,
		})
	}, func(p *domain.Preview) string { return p.Origin }, 2)
}
