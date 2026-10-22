package cache

// Cache is the read-write surface a caller needs from a cache, so a service
// can take one without taking a dependency on how it evicts or whether it
// meters.
type Cache[Key comparable, Value any] interface {
	Add(key Key, value Value) (evicted bool)
	Get(key Key) (value Value, ok bool)
}
