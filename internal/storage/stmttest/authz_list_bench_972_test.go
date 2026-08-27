//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

// DIAGNOSTIC (#972) — DO NOT MERGE.
//
// Times the team-scoped list predicate against a synthetic dataset, sweeping
// which arms of the disjunction are emitted (authz.DiagListArms) so one seeded
// dataset produces the whole differential in a single process.
//
// Two parts, because the full matrix is unaffordable: a single measurement at
// outer=10/noise=100 already costs ~23s on the spanner emulator.
//
//   - Differential (one size, all four arm subsets, both queries): which arms
//     carry the cost.
//   - Curve (five sizes, two axes isolated, teams only): how that cost scales.
//     It measures "all" and "constant-only", because a query-constant whose
//     cost grows with the number of outer rows is by definition being
//     re-evaluated per row. That is the whole claim.
//
// Reading the variants: "constant-only" reduces the predicate to a constant, so
// an engine that folds it returns zero rows without scanning (sqlite does this
// and reports 0ms). A *fast* constant-only therefore proves nothing; a *slow*
// one is damning. "none" is the floor: RSI existence by primary key alone.
//
// ListUsers is a third discriminator needing no SQL surgery: user RSI rows carry
// NULL team_id, so the team-scoped arm is structurally dead there.
//
// Skipped unless ZITADEL_BENCH_972 is set, because the moon test tasks run
// ./... and an unguarded bench would inflate every existing lane.

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

type bench972Size struct {
	// outerN is teams and users created, i.e. rows the predicate is evaluated against.
	outerN int
	// noiseN is extra authz_assignments rows granting the principal nothing,
	// growing the join input without changing the result set.
	noiseN int
}

func (s bench972Size) name() string { return fmt.Sprintf("outer=%d_noise=%d", s.outerN, s.noiseN) }

// bench972DiffSize is the one size the four-way differential runs at.
var bench972DiffSize = bench972Size{outerN: 10, noiseN: 100}

// bench972CurveSizes isolates each axis, sharing the outer=20/noise=50 corner,
// so six curve points come from five seeds. Sizes are small because cost is
// roughly proportional to outerN*noiseN and the emulator charges ~23ms per unit.
var bench972CurveSizes = []bench972Size{
	{outerN: 10, noiseN: 50},
	{outerN: 20, noiseN: 50},
	{outerN: 40, noiseN: 50},
	{outerN: 20, noiseN: 25},
	{outerN: 20, noiseN: 100},
}

type bench972Variant struct {
	name string
	arms authz.DiagListArmMask
}

var (
	bench972AllVariants = []bench972Variant{
		{"all", authz.DiagListArmsAll},
		{"constant-only", authz.DiagListArmsConstant},
		{"correlated-only", authz.DiagListArmsCorrelated},
		{"none", authz.DiagListArmsNone},
	}
	bench972CurveVariants = []bench972Variant{
		{"all", authz.DiagListArmsAll},
		{"constant-only", authz.DiagListArmsConstant},
	}
)

type bench972Fixture struct {
	projectID string
	grantedID string
	principal string
	catalogID string
}

// TestAuthzListBench972Differential answers which arms carry the cost.
func TestAuthzListBench972Differential(t *testing.T) {
	skipUnlessBench972(t)
	t.Cleanup(func() { authz.DiagListArms = authz.DiagListArmsAll })

	forEachDialect(t, func(t *testing.T, d dialect) {
		f := seedBench972(t, d, bench972DiffSize)
		for _, v := range bench972AllVariants {
			authz.DiagListArms = v.arms
			for _, q := range []string{"teams", "users"} {
				elapsed, rows := timeBench972(t, d, f, q)
				report972(t, d, bench972DiffSize, v.name, q, elapsed, rows)
			}
		}
		authz.DiagListArms = authz.DiagListArmsAll
	})
}

// TestAuthzListBench972Curve answers how that cost scales on each axis.
func TestAuthzListBench972Curve(t *testing.T) {
	skipUnlessBench972(t)
	t.Cleanup(func() { authz.DiagListArms = authz.DiagListArmsAll })

	forEachDialect(t, func(t *testing.T, d dialect) {
		for _, size := range bench972CurveSizes {
			t.Run(size.name(), func(t *testing.T) {
				f := seedBench972(t, d, size)
				for _, v := range bench972CurveVariants {
					authz.DiagListArms = v.arms
					elapsed, rows := timeBench972(t, d, f, "teams")
					report972(t, d, size, v.name, "teams", elapsed, rows)
				}
				authz.DiagListArms = authz.DiagListArmsAll
			})
		}
	})
}

func skipUnlessBench972(t *testing.T) {
	t.Helper()
	if os.Getenv("ZITADEL_BENCH_972") == "" {
		t.Skip("set ZITADEL_BENCH_972=1 to run the #972 list-predicate benchmark")
	}
}

// report972 emits one machine-readable line per measurement, so a CI step log
// can be scraped straight into the results table.
func report972(t *testing.T, d dialect, size bench972Size, variant, query string, elapsed time.Duration, rows int) {
	t.Helper()
	t.Logf("BENCH972 dialect=%s outer=%d noise=%d variant=%s query=%s ms=%d rows=%d",
		d.name, size.outerN, size.noiseN, variant, query, elapsed.Milliseconds(), rows)
}

func timeBench972(t *testing.T, d dialect, f bench972Fixture, query string) (time.Duration, int) {
	t.Helper()

	kind := domain.ResourceKindTeam
	if query == "users" {
		kind = domain.ResourceKindUser
	}
	ctx := service.WithAuthzListFilter(t.Context(), service.AuthzListFilter{
		AuthzCheckParams: domain.AuthzCheckParams{
			CatalogID: f.catalogID, ProjectID: f.projectID, PrincipalHomeProjectID: f.projectID,
			PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: f.principal,
			ObjectType: "project", Relation: "viewer",
		},
		ResourceKind: kind,
	})

	start := time.Now()
	var rows int
	if query == "teams" {
		res, err := d.stmts.ListTeams(ctx, &database.ListOptions[domain.TeamField]{
			Filter: database.Equal(database.Col(domain.TeamFieldProjectID), f.projectID),
		})
		require.NoError(t, err)
		rows = len(res.Items)
	} else {
		res, err := d.stmts.ListUsers(ctx, &database.ListOptions[domain.UserField]{
			Filter: database.Equal(database.Col(domain.UserFieldProjectID), f.projectID),
		}, service.UserQueryOptions{})
		require.NoError(t, err)
		rows = len(res.Items)
	}
	return time.Since(start), rows
}

// seedBench972 builds one dataset through the production write path, so RSI rows
// and membership edges stay consistent. CreateTeam already stamps RSI.team_id
// via domain.NewTeamResourceScope, and CreateUser deliberately leaves it NULL.
func seedBench972(t *testing.T, d dialect, size bench972Size) bench972Fixture {
	t.Helper()
	ctx := t.Context()
	start := time.Now()

	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	suffix := uniqueSuffix(t)

	teamIDs := make([]string, size.outerN)
	for i := range size.outerN {
		id := fmt.Sprintf("team-%d-%s", i, suffix)
		require.NoError(t, d.stmts.CreateTeam(ctx, newTestTeam(projectID, id)))
		teamIDs[i] = id
	}
	for i := range size.outerN {
		id := fmt.Sprintf("usr-%d-%s", i, suffix)
		require.NoError(t, d.stmts.CreateUser(ctx,
			newTestUser(t, projectID, schemaURL, id, id+"@example.com", "Bench")))
	}

	principal := "usr-principal-" + suffix
	require.NoError(t, d.stmts.CreateUser(ctx,
		newTestUser(t, projectID, schemaURL, principal, principal+"@example.com", "Principal")))

	catalogID, err := d.stmts.ActiveSystemCatalogID(ctx)
	require.NoError(t, err)

	// The one grant under test: team-scoped, so exactly one team is visible and
	// the engine must still evaluate every outer row to find it.
	require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, newTestAssignment(
		projectID, "asgn-granted-"+suffix,
		domain.AuthzPrincipalTypeUser, principal,
		"project", "viewer", domain.NewTeamAssignmentScope(teamIDs[0]))))

	// Noise: grants to other principals, spread across all three scope kinds so
	// every arm of the disjunction has rows to sift. Distinct principal IDs keep
	// authz_assignments_unique_active satisfied.
	for i := range size.noiseN {
		var scope domain.AuthzAssignmentScope
		switch i % 3 {
		case 0:
			scope = domain.NewProjectAssignmentScope()
		case 1:
			scope = domain.NewTeamAssignmentScope(teamIDs[i%len(teamIDs)])
		default:
			scope = domain.NewResourceAssignmentScope(teamIDs[i%len(teamIDs)])
		}
		require.NoError(t, d.stmts.CreateAuthzAssignment(ctx, newTestAssignment(
			projectID, fmt.Sprintf("asgn-noise-%d-%s", i, suffix),
			domain.AuthzPrincipalTypeUser, fmt.Sprintf("usr-noise-%d-%s", i, suffix),
			"project", "viewer", scope)))
	}

	t.Logf("BENCH972SEED dialect=%s outer=%d noise=%d seed_ms=%d",
		d.name, size.outerN, size.noiseN, time.Since(start).Milliseconds())

	return bench972Fixture{
		projectID: projectID,
		grantedID: teamIDs[0],
		principal: principal,
		catalogID: catalogID,
	}
}
