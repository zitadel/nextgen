package api

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestScopeAllowed(t *testing.T) {
	tests := []struct {
		name     string
		granted  []string
		accepted []string
		want     bool
	}{
		{"project secret reaches everything", []string{"project.write", "project.read"}, nil, true},
		{"project.write implies the finer scope", []string{"project.write"}, []string{"schema.write"}, true},
		{"finer scope matches", []string{"schema.write"}, []string{"schema.write"}, true},
		{"finer scope from the accepted list", []string{"schema.read"}, []string{"schema.read", "schema.write"}, true},
		{"preview secret grants nothing", []string{"project.read"}, []string{"schema.read", "schema.write"}, false},
		{"unrelated finer scope", []string{"user.write"}, []string{"schema.write"}, false},
		{"no scopes", nil, []string{"schema.read"}, false},
		{"empty accepted list only admits project.write", []string{"project.read", "schema.write"}, nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := scopeAllowed(tt.granted, tt.accepted); got != tt.want {
				t.Fatalf("scopeAllowed(%v, %v) = %v, want %v", tt.granted, tt.accepted, got, tt.want)
			}
		})
	}
}

// TestResourceAccessScopes pins the per-resource scope tables: which finer
// scopes reach which operation, write-implies-read, and the two deliberate
// asymmetries (flow_definition.write does not imply delete; project reads
// admit no finer scope because project.read is the preview secret's).
func TestResourceAccessScopes(t *testing.T) {
	tests := []struct {
		name  string
		res   resourceAccess
		op    accessOp
		scope string
		want  bool
	}{
		{"schema.write writes", schemaAccess, opWrite, "schema.write", true},
		{"schema.write implies read", schemaAccess, opRead, "schema.write", true},
		{"schema.read reads", schemaAccess, opRead, "schema.read", true},
		{"schema.read cannot write", schemaAccess, opWrite, "schema.read", false},

		{"flow_definition.write writes", flowDefinitionAccess, opWrite, "flow_definition.write", true},
		{"flow_definition.write implies read", flowDefinitionAccess, opRead, "flow_definition.write", true},
		{"flow_definition.write does not imply delete", flowDefinitionAccess, opDelete, "flow_definition.write", false},
		{"flow_definition.delete deletes", flowDefinitionAccess, opDelete, "flow_definition.delete", true},
		{"flow_definition.read cannot write", flowDefinitionAccess, opWrite, "flow_definition.read", false},

		{"user.write writes", userAccess, opWrite, "user.write", true},
		{"user.read reads", userAccess, opRead, "user.read", true},
		{"user.read cannot write", userAccess, opWrite, "user.read", false},
		{"user.write does not imply delete", userAccess, opDelete, "user.write", false},
		{"user.read does not imply delete", userAccess, opDelete, "user.read", false},
		{"user.delete deletes", userAccess, opDelete, "user.delete", true},
		{"user.delete cannot write", userAccess, opWrite, "user.delete", false},
		{"user.delete cannot read", userAccess, opRead, "user.delete", false},

		// A resource that declares no delete scope admits nothing finer than
		// the operator-grade project secret for deletes.
		{"schema.write does not delete", schemaAccess, opDelete, "schema.write", false},

		{"team.write writes", teamAccess, opWrite, "team.write", true},
		{"team.read reads", teamAccess, opRead, "team.read", true},
		{"team.read cannot write", teamAccess, opWrite, "team.read", false},
		{"team.delete deletes", teamAccess, opDelete, "team.delete", true},
		{"team.write does not imply delete", teamAccess, opDelete, "team.write", false},
		{"team.read does not imply delete", teamAccess, opDelete, "team.read", false},
		{"team.delete cannot write", teamAccess, opWrite, "team.delete", false},
		{"team.delete cannot read", teamAccess, opRead, "team.delete", false},

		{"session.read reads", sessionAccess, opRead, "session.read", true},
		{"sessions.read reads", sessionAccess, opRead, "sessions.read", true},
		{"session.write implies read", sessionAccess, opRead, "session.write", true},
		{"session.read cannot delete", sessionAccess, opDelete, "session.read", false},
		{"session.delete deletes", sessionAccess, opDelete, "session.delete", true},
		{"sessions.delete deletes", sessionAccess, opDelete, "sessions.delete", true},
		// Strict is the default: sessions do not opt into the legacy umbrella.
		{"project.write does not read sessions", sessionAccess, opRead, "project.write", false},
		{"project.write does not revoke sessions", sessionAccess, opDelete, "project.write", false},

		{"project.read does not read project management state", projectAccess, opRead, "project.read", false},
		{"project.read cannot write project state", projectAccess, opWrite, "project.read", false},
		{"project.write reaches patchProject", projectAccess, opWrite, "project.write", true},
		// queryProjects has no project parameter of its own and binds to the
		// token's project like getProject: only project.write reaches it.
		{"project.write reaches queryProjects (opRead)", projectAccess, opRead, "project.write", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.res.allows([]string{tt.scope}, tt.op); got != tt.want {
				t.Fatalf("scope %q for op %d = %v, want %v", tt.scope, tt.op, got, tt.want)
			}
		})
	}
}

func TestRequireProjectAccess(t *testing.T) {
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"project.write", "project.read"},
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"project.read"},
	})

	resources := []struct {
		name string
		res  resourceAccess
		// expected error codes
		readMiss, writeMiss, denied string
	}{
		{
			name:     "schema",
			res:      schemaAccess,
			readMiss: domain.ErrJSONSchemaNotFound().Code, writeMiss: domain.ErrJSONSchemaInvalid().Code,
			denied: domain.ErrJSONSchemaPermissionDenied().Code,
		},
		{
			name:     "flow definition",
			res:      flowDefinitionAccess,
			readMiss: domain.ErrFlowDefinitionNotFound().Code, writeMiss: domain.ErrFlowDefinitionInvalid(nil, nil).Code,
			denied: domain.ErrFlowDefinitionPermissionDenied().Code,
		},
		{
			name:     "user",
			res:      userAccess,
			readMiss: domain.ErrUserNotFound().Code, writeMiss: domain.ErrUserInvalid().Code,
			denied: domain.ErrUserPermissionDenied().Code,
		},
		{
			name:     "team",
			res:      teamAccess,
			readMiss: domain.ErrTeamNotFound().Code, writeMiss: domain.ErrTeamProjectNotFound().Code,
			denied: domain.ErrTeamPermissionDenied().Code,
		},
		// sessionAccess is deliberately absent: it does not opt into the
		// legacy umbrella, so the project secret does not reach it. See the
		// dedicated subtest.
		{
			name:     "project",
			res:      projectAccess,
			readMiss: domain.ErrProjectNotFound().Code, writeMiss: domain.ErrProjectNotFound().Code,
			denied: domain.ErrProjectPermissionDenied().Code,
		},
	}

	for _, res := range resources {
		t.Run(res.name, func(t *testing.T) {
			if err := requireProjectAccess(operator, "proj_a", res.res, opWrite); err != nil {
				t.Fatalf("own-project write with the project secret should pass: %v", err)
			}
			if err := requireProjectAccess(operator, "proj_a", res.res, opRead); err != nil {
				t.Fatalf("own-project read with the project secret should pass: %v", err)
			}

			// Foreign projects answer exactly like nonexistent ones (anti-oracle).
			err := requireProjectAccess(operator, "proj_b", res.res, opWrite)
			assertDomainCode(t, err, res.writeMiss)
			err = requireProjectAccess(operator, "proj_b", res.res, opRead)
			assertDomainCode(t, err, res.readMiss)

			// The preview secret is a browser-plane credential: no management
			// access, not even on its own project.
			err = requireProjectAccess(preview, "proj_a", res.res, opWrite)
			assertDomainCode(t, err, res.denied)
			err = requireProjectAccess(preview, "proj_a", res.res, opRead)
			assertDomainCode(t, err, res.denied)

			// No scope context at all behaves like a foreign project.
			err = requireProjectAccess(context.Background(), "proj_a", res.res, opRead)
			assertDomainCode(t, err, res.readMiss)
		})
	}

	// Every resource that declares a *.delete scope gates deletes on it alone:
	// deleteUserByID and deleteFlowDefinition are the two operations reached
	// this way. Sessions are covered separately below because they refuse the
	// project.write umbrella.
	deletable := []struct {
		name                    string
		res                     resourceAccess
		writeScope, deleteScope string
		denied, readMiss        string
	}{
		{
			name: "flow definition", res: flowDefinitionAccess,
			writeScope: "flow_definition.write", deleteScope: "flow_definition.delete",
			denied:   domain.ErrFlowDefinitionPermissionDenied().Code,
			readMiss: domain.ErrFlowDefinitionNotFound().Code,
		},
		{
			name: "user", res: userAccess,
			writeScope: "user.write", deleteScope: "user.delete",
			denied:   domain.ErrUserPermissionDenied().Code,
			readMiss: domain.ErrUserNotFound().Code,
		},
	}

	for _, res := range deletable {
		t.Run(res.name+" delete is scope-gated separately", func(t *testing.T) {
			writer := WithScopeContext(context.Background(), ScopeContext{
				ProjectID: "proj_a",
				Scope:     []string{res.writeScope},
			})
			deleter := WithScopeContext(context.Background(), ScopeContext{
				ProjectID: "proj_a",
				Scope:     []string{res.deleteScope},
			})

			// Write does not imply delete…
			err := requireProjectAccess(writer, "proj_a", res.res, opDelete)
			assertDomainCode(t, err, res.denied)

			// …and the delete scope reaches the delete and nothing else.
			if err := requireProjectAccess(deleter, "proj_a", res.res, opDelete); err != nil {
				t.Fatalf("the resource's delete scope must reach delete: %v", err)
			}
			err = requireProjectAccess(deleter, "proj_a", res.res, opWrite)
			assertDomainCode(t, err, res.denied)
			err = requireProjectAccess(deleter, "proj_a", res.res, opRead)
			assertDomainCode(t, err, res.denied)

			if err := requireProjectAccess(operator, "proj_a", res.res, opDelete); err != nil {
				t.Fatalf("project.write implies delete: %v", err)
			}

			err = requireProjectAccess(preview, "proj_a", res.res, opDelete)
			assertDomainCode(t, err, res.denied)
		})

		t.Run(res.name+" foreign deletes miss like reads", func(t *testing.T) {
			err := requireProjectAccess(operator, "proj_b", res.res, opDelete)
			assertDomainCode(t, err, res.readMiss)

			err = requireProjectAccess(context.Background(), "proj_a", res.res, opDelete)
			assertDomainCode(t, err, res.readMiss)
		})
	}

	// listUserTeams reads two resources at once, so neither read alone reaches
	// it. The roster carries team names; user.read must not be a side door to
	// them.
	t.Run("user teams require both reads", func(t *testing.T) {
		userOnly := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"user.read"},
		})
		teamOnly := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"team.read"},
		})
		both := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"user.read", "team.read"},
		})

		// user.read alone stops at the team read, and vice versa.
		err := requireUserTeamsAccess(userOnly, "proj_a")
		assertDomainCode(t, err, domain.ErrTeamPermissionDenied().Code)

		err = requireUserTeamsAccess(teamOnly, "proj_a")
		assertDomainCode(t, err, domain.ErrUserPermissionDenied().Code)

		if err := requireUserTeamsAccess(both, "proj_a"); err != nil {
			t.Fatalf("both reads together must reach the roster: %v", err)
		}

		// The write scopes imply their reads, as everywhere else in this model.
		writers := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"user.write", "team.write"},
		})
		if err := requireUserTeamsAccess(writers, "proj_a"); err != nil {
			t.Fatalf("write scopes imply their reads: %v", err)
		}

		if err := requireUserTeamsAccess(operator, "proj_a"); err != nil {
			t.Fatalf("project.write reaches both reads: %v", err)
		}

		// The preview secret reaches neither, and the user check answers first.
		err = requireUserTeamsAccess(preview, "proj_a")
		assertDomainCode(t, err, domain.ErrUserPermissionDenied().Code)

		// A foreign project answers with the endpoint's documented 404 rather
		// than disclosing that the binding was also evaluated against teams.
		err = requireUserTeamsAccess(operator, "proj_b")
		assertDomainCode(t, err, domain.ErrUserNotFound().Code)

		err = requireUserTeamsAccess(context.Background(), "proj_a")
		assertDomainCode(t, err, domain.ErrUserNotFound().Code)
	})

	t.Run("team deletes are denied rather than missed", func(t *testing.T) {
		err := requireTeamDelete(operator, "proj_b")
		assertDomainCode(t, err, domain.ErrTeamPermissionDenied().Code)

		err = requireTeamDelete(context.Background(), "proj_a")
		assertDomainCode(t, err, domain.ErrTeamPermissionDenied().Code)

		err = requireTeamDelete(preview, "proj_a")
		assertDomainCode(t, err, domain.ErrTeamPermissionDenied().Code)

		if err := requireTeamDelete(operator, "proj_a"); err != nil {
			t.Fatalf("project.write implies team.delete: %v", err)
		}
	})

	// Sessions keep the strict default rather than opting into the legacy
	// project.write umbrella: revoking sessions logs people out, which is not
	// project administration.
	t.Run("session management refuses the project.write umbrella", func(t *testing.T) {
		err := requireProjectAccess(operator, "proj_a", sessionAccess, opRead)
		assertDomainCode(t, err, domain.ErrSessionPermissionDenied().Code)
		err = requireProjectAccess(operator, "proj_a", sessionAccess, opDelete)
		assertDomainCode(t, err, domain.ErrSessionPermissionDenied().Code)
		err = requireProjectAccess(preview, "proj_a", sessionAccess, opRead)
		assertDomainCode(t, err, domain.ErrSessionPermissionDenied().Code)

		reader := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"session.read"},
		})
		if err := requireProjectAccess(reader, "proj_a", sessionAccess, opRead); err != nil {
			t.Fatalf("session.read should reach an own-project read: %v", err)
		}
		err = requireProjectAccess(reader, "proj_a", sessionAccess, opDelete)
		assertDomainCode(t, err, domain.ErrSessionPermissionDenied().Code)

		deleter := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"session.delete"},
		})
		if err := requireProjectAccess(deleter, "proj_a", sessionAccess, opDelete); err != nil {
			t.Fatalf("session.delete should reach an own-project revoke: %v", err)
		}

		// Binding is checked before scopes, so a foreign project still misses
		// rather than denying — the anti-oracle answer holds under strict
		// matching too.
		err = requireProjectAccess(deleter, "proj_b", sessionAccess, opDelete)
		assertDomainCode(t, err, domain.ErrSessionNotFound().Code)
	})
}

func assertDomainCode(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	domErr, ok := err.(domain.Error)
	if !ok {
		t.Fatalf("expected a domain.Error, got %T: %v", err, err)
	}
	if domErr.Code != want {
		t.Fatalf("code = %q, want %q", domErr.Code, want)
	}
}
