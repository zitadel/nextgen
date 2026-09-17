package cache

// The names these caches report under; see the metrics package for the series.
// They are exported because whoever builds a cache names it: cache.MeteredLRU
// is generic and cannot name itself, and two caches built under the same name
// sum into one series.
const (
	NameCrypter    = "crypter"
	NameSigningKey = "signing_key"
)
