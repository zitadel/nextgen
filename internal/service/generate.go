package service

// One mockgen invocation for the whole package. mockgen's cost is per-run —
// it type-loads the package before it mocks anything — so splitting this per
// interface costs a full package load each time and buys nothing. Add new
// interfaces to the list below rather than adding a directive.

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/service.mock.go . StatementPool,Statements,AllStatements,ProjectStatements,FlowDefinitionStatements,CryptoKeyStatements,JSONSchemaStatements,TeamStatements,TeamMembershipStatements,TokenStatements,PasskeyRegistrationStatements,SessionStatements,AuthAttemptStatements,UserStatements,UserPasswordStatements,UserTOTPStatements,UserPasskeyStatements,UserRecoveryCodesStatements,BrandingStatements,ClaimStatements,ResourceScopeStatements,AuthzAssignmentStatements,AuthzMembershipEdgeStatements,AuthzCatalogStatements,Pool,Transactioner,Statementer,SessionService,TokenService,KeyService,SessionResolver,UserLookup
