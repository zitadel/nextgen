package crypto

// One mockgen invocation for the whole package. mockgen's cost is per-run —
// it type-loads the package before it mocks anything — so splitting this per
// interface costs a full package load each time and buys nothing. Add new
// interfaces to the list below rather than adding a directive.

//go:generate go tool mockgen -typed -package cryptomock -destination ./mock/crypto.mock.go . Hasher,HashVerifier,HashValidator,Encrypter,Decrypter,Crypter
