package openfga_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/authz/openfga"
)

func FuzzParseDSL(f *testing.F) {
	for _, seed := range []string{
		"",
		"model",
		"not a model",
		`model
  schema 1.1

type user
`,
		`model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define team: [team]
    define viewer: [user, team#member] or member from team
    define editor: viewer
    define admin: [user] or editor
`,
		`{"schema_version":"1.1","type_definitions":[{"type":"user"}]}`,
	} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, input string) {
		_, _ = openfga.ParseDSL(input)
	})
}

func FuzzParseJSON(f *testing.F) {
	for _, seed := range []string{
		"",
		"{}",
		"null",
		`{"schema_version":"1.1","type_definitions":[{"type":"user"}]}`,
		`{"schema_version":"1.1","type_definitions":[{"type":"document","relations":{"viewer":{"this":{}}},"metadata":{"relations":{"viewer":{"directly_related_user_types":[{"type":"user"}]}}}}]}`,
	} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, input string) {
		_, _ = openfga.ParseJSON(input)
	})
}
