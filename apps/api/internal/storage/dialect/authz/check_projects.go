package authz

import (
	"strconv"

	"github.com/zitadel/nextgen/internal/domain"
)

// WriteCheckAuthzProjects emits WriteCheckAuthz for each of projectIDs in one
// statement: a row of (arm, allowed, foothold) per project, arm its index in
// projectIDs, each the same bounded check WriteCheckAuthz writes for that
// project alone. params.ProjectID is ignored. It is what lets a search over
// several projects decide them all in one round trip.
func WriteCheckAuthzProjects(w ArgWriter, env Env, params domain.AuthzCheckParams, projectIDs []string) {
	for i, projectID := range projectIDs {
		if i > 0 {
			w.WriteString("\nUNION ALL\n")
		}
		p := params
		p.ProjectID = projectID
		w.WriteString("SELECT " + strconv.Itoa(i) + ", (")
		writePrincipalActiveAnd(w, env, p.HomeProjectID(), p.PrincipalType, p.PrincipalID)
		writeCheckAllowed(w, env, p)
		w.WriteString("), (")
		writePrincipalActiveAnd(w, env, p.HomeProjectID(), p.PrincipalType, p.PrincipalID)
		writeFoothold(w, env, p.ProjectID, p.HomeProjectID(), p.PrincipalType, p.PrincipalID)
		w.WriteString(")")
	}
}
