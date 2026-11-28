package cache

// Disabled is a Cache that keeps nothing: every Get misses. It stands in
// for a cache a configuration turns off, so the caller needs no nil check.
type Disabled[Key comparable, Value any] struct{}

func (Disabled[Key, Value]) Add(Key, Value) (evicted bool) { return false }

func (Disabled[Key, Value]) Get(Key) (value Value, ok bool) { return value, false }
