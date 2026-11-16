package spanner

import (
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

// Spanner refuses a query with more than 20 joins, which the check of the ten
// projects one search reads was, in one statement. A check that gains a join
// has to lower checkAuthzProjectsPerStatement with it.
func TestCheckAuthzProjectsStatementStaysWithinSpannersJoinLimit(t *testing.T) {
	t.Parallel()
	const spannerJoinLimit = 20

	projects := make([]string, checkAuthzProjectsPerStatement)
	for i := range projects {
		projects[i] = "proj_" + strconv.Itoa(i)
	}
	for _, principal := range []domain.AuthzPrincipalType{
		domain.AuthzPrincipalTypeUser,
		domain.AuthzPrincipalTypeTeam,
		domain.AuthzPrincipalTypeAgent,
		domain.AuthzPrincipalTypeSKProj,
	} {
		t.Run(principal.String(), func(t *testing.T) {
			t.Parallel()
			var c statementCompiler
			authz.WriteCheckAuthzProjects(&c, spannerAuthzEnv(), domain.AuthzCheckParams{
				CatalogID:              "cat_1",
				PrincipalHomeProjectID: "proj_home",
				PrincipalType:          principal,
				PrincipalID:            "principal_1",
				ObjectType:             "project",
				Relation:               "viewer",
				PlatformProjectID:      "proj_home",
			}, projects)

			joins := strings.Count(c.String(), "JOIN ")
			assert.Positive(t, joins, "the check no longer joins: this test counts nothing")
			assert.LessOrEqual(t, joins, spannerJoinLimit)
		})
	}
}
