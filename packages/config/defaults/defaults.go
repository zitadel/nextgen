// Package defaults embeds the versioned Zitadel config defaults shared by the CLI and server fallback path.
package defaults

import _ "embed"

// DefaultFlowSchemaURI is the canonical flow definition authoring schema URI.
const DefaultFlowSchemaURI = "https://nextgen.com/flow-definition.json"

//go:embed default-human-user.json
var defaultHumanUserSchema []byte

//go:embed default-login.json
var defaultLoginFlowDefinition []byte

// DefaultHumanUserSchema returns a copy of the default human user schema template.
func DefaultHumanUserSchema() []byte {
	return append([]byte(nil), defaultHumanUserSchema...)
}

// DefaultLoginFlowDefinition returns a copy of the default login flow template.
func DefaultLoginFlowDefinition() []byte {
	return append([]byte(nil), defaultLoginFlowDefinition...)
}
