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
// asymmetries (flow_definitions.write does not imply delete; project reads
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

		{"flow_definitions.write writes", flowDefinitionAccess, opWrite, "flow_definitions.write", true},
		{"flow_definitions.write implies read", flowDefinitionAccess, opRead, "flow_definitions.write", true},
		{"flow_definitions.write does not imply delete", flowDefinitionAccess, opDelete, "flow_definitions.write", false},
		{"flow_definitions.delete deletes", flowDefinitionAccess, opDelete, "flow_definitions.delete", true},
		{"flow_definitions.read cannot write", flowDefinitionAccess, opWrite, "flow_definitions.read", false},

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

		{"project.read does not read project management state", projectAccess, opRead, "project.read", false},
		{"project.read cannot write project state", projectAccess, opWrite, "project.read", false},
		{"project.write reaches patchProject", projectAccess, opWrite, "project.write", true},
		// queryProjects has no project parameter of its own and binds to the
		// token's project like getProject: only project.write reaches it.
		{"project.write reaches queryProjects (opRead)", projectAccess, opRead, "project.write", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := scopeAllowed([]string{tt.scope}, tt.res.scopes[tt.op]); got != tt.want {
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
	// this way.
	deletable := []struct {
		name                    string
		res                     resourceAccess
		writeScope, deleteScope string
		denied, readMiss        string
	}{
		{
			name: "flow definition", res: flowDefinitionAccess,
			writeScope: "flow_definitions.write", deleteScope: "flow_definitions.delete",
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
