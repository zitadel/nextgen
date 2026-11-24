package flowenginemock

// One mockgen invocation for the whole internal/flowengine package. mockgen's cost is per-run
// — it type-loads the package before it mocks anything — so splitting this per
// interface costs a full package load each time and buys nothing. Add new
// interfaces to the list below rather than adding a directive.
//
// The directive lives here, in the mock package, rather than beside the
// interfaces: mockgen has to type-check internal/flowengine, which imports
// internal/domain, which does not compile until its generated `*_enumer.go`
// files exist. `go generate ./...` walks packages in import-path order, so
// `internal/domain` is fully generated before this one is reached. That is
// what lets generation bootstrap from a tree with no generated files in it.

//go:generate go tool mockgen -typed -package flowenginemock -destination ./flowengine.mock.go github.com/zitadel/nextgen/internal/flowengine FlowOnSuccessHandler,FlowAuthAttemptService,FlowSSOProviderResolver,FlowSSOIdentityService,FlowSSORedirectIssuer
