package mocks

// One mockgen invocation for the whole internal/service package. mockgen's cost is per-run
// — it type-loads the package before it mocks anything — so splitting this per
// interface costs a full package load each time and buys nothing. Add new
// interfaces to the list below rather than adding a directive.
//
// The directive lives here, in the mock package, rather than beside the
// interfaces: mockgen has to type-check internal/service, which does not compile until
// its generated `*_enumer.go` files exist. `go generate ./...` walks packages
// in import-path order, so `internal/service` (and everything it imports) is fully
// generated before this one is reached. That is what lets generation bootstrap
// from a tree with no generated files in it.

//go:generate go tool mockgen -typed -package mocks -destination ./service.mock.go github.com/zitadel/nextgen/internal/service StatementPool,Statements,AllStatements,ProjectStatements,FlowDefinitionStatements,CryptoKeyStatements,JSONSchemaStatements,TeamStatements,TeamMembershipStatements,TokenStatements,PasskeyRegistrationStatements,SessionStatements,AuthAttemptStatements,UserStatements,UserPasswordStatements,UserTOTPStatements,UserPasskeyStatements,UserRecoveryCodesStatements,BrandingStatements,ClaimStatements,ResourceScopeStatements,AuthzAssignmentStatements,AuthzMembershipEdgeStatements,AuthzCatalogStatements,EventStatements,Pool,Transactioner,Statementer,SessionService,TokenService,KeyService,SessionResolver,UserLookup
