package cryptomock

// One mockgen invocation for the whole internal/crypto package. mockgen's cost is per-run
// — it type-loads the package before it mocks anything — so splitting this per
// interface costs a full package load each time and buys nothing. Add new
// interfaces to the list below rather than adding a directive.
//
// The directive lives here, in the mock package, rather than beside the
// interfaces: mockgen has to type-check internal/crypto, which does not compile until
// its generated `*_enumer.go` files exist. `go generate ./...` walks packages
// in import-path order, so `internal/crypto` (and everything it imports) is fully
// generated before this one is reached. That is what lets generation bootstrap
// from a tree with no generated files in it.

//go:generate go tool mockgen -typed -package cryptomock -destination ./crypto.mock.go github.com/zitadel/nextgen/internal/crypto Hasher,HashVerifier,HashValidator,Encrypter,Decrypter,Crypter
