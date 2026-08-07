package domain

// One mockgen invocation for the whole package. mockgen's cost is per-run —
// it type-loads the package before it mocks anything — so splitting this per
// interface costs a full package load each time and buys nothing. Add new
// interfaces to the list below rather than adding a directive.
//
// The enumer directives stay next to their types: enumer names its output
// after the type, so one file per type is what keeps those names honest.

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/domain.mock.go . SchemaResolver,FlowFieldResolver,FlowPasskeyRegistrationService,FlowOnSuccessHandler,FlowPasskeyUserCreater,JSONSchemaStore,FlowAuthAttemptService
