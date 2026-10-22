package compiler_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/authz/authztest"
)

func FuzzCompileInvariants(f *testing.F) {
	for i := 0; i < 16; i++ {
		f.Add(authztest.Seed(i))
	}
	f.Add([]byte{})
	f.Add([]byte{0xff, 0x00, 0xaa, 0x55})

	f.Fuzz(func(t *testing.T, data []byte) {
		checkCompileInvariants(t, authztest.GenerateModel(data))
	})
}

func TestCompileInvariants_DSLFixtures(t *testing.T) {
	t.Parallel()
	fixtures := []struct {
		name string
		dsl  string
	}{
		{
			name: "direct_document_viewer",
			dsl: `model
  schema 1.1

type user

type document
  relations
    define viewer: [user]
`,
		},
		{
			name: "project_team_implication",
			dsl: `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define team: [team]
    define viewer: [user] or member from team
    define editor: viewer
`,
		},
	}
	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			t.Parallel()
			checkCompileInvariants(t, parse(t, fixture.dsl))
		})
	}
}
