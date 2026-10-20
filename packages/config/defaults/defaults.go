// Package defaults embeds the versioned Zitadel config defaults shared by the CLI and server fallback path.
package defaults

import _ "embed"

// DefaultBuiltinSchemaBase is the namespace the built-in schemas are named
// under, and the server's default `schema.builtin_public_base`. It is an
// identifier, not an address: it is stamped into schema documents and stored
// rows, and nothing under it is fetched. TypeScript's twin is
// DEFAULT_BUILTIN_SCHEMA_BASE in packages/config/src/defaults.ts.
const DefaultBuiltinSchemaBase = "https://zitadel.com/schemas/v1"

// DefaultFlowSchemaURI is the canonical flow definition authoring schema URI.
const DefaultFlowSchemaURI = DefaultBuiltinSchemaBase + "/flow-definition.json"

//go:embed default-human-user.json
var defaultHumanUserSchema []byte

//go:embed default-login.json
var defaultLoginFlowDefinition []byte

//go:embed README-schemas.md
var schemasReadme []byte

//go:embed README-flows.md
var flowsReadme []byte

// DefaultHumanUserSchema returns a copy of the default human user schema template.
func DefaultHumanUserSchema() []byte {
	return append([]byte(nil), defaultHumanUserSchema...)
}

// DefaultLoginFlowDefinition returns a copy of the default login flow template.
func DefaultLoginFlowDefinition() []byte {
	return append([]byte(nil), defaultLoginFlowDefinition...)
}

// SchemasReadme returns the README content the CLI copies to
// `.zitadel/schemas/README.md` at setup time.
func SchemasReadme() []byte {
	return append([]byte(nil), schemasReadme...)
}

// FlowsReadme returns the README content the CLI copies to
// `.zitadel/flows/README.md` at setup time.
func FlowsReadme() []byte {
	return append([]byte(nil), flowsReadme...)
}
