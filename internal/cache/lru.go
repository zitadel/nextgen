package cache

import (
	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

type MeteredLRU[Key comparable, Value any] struct {
	cache   *lru.Cache[Key, Value]
	metrics *metrics.Cache
}

func NewMeteredLRU[Key comparable, Value any](name string, size int, opts ...metrics.Option) (*MeteredLRU[Key, Value], error) {
	cache, err := lru.New[Key, Value](size)
	if err != nil {
		return nil, err
	}

	instruments, err := metrics.NewCache(name, cache.Len, opts...)
	if err != nil {
		return nil, err
	}
	return new(MeteredLRU[Key, Value]{cache: cache, metrics: instruments}), nil
}

func (c MeteredLRU[Key, Value]) Add(key Key, value Value) (evicted bool) {
	evicted = c.cache.Add(key, value)
	c.metrics.RecordAdd(evicted)
	return evicted
}

func (c MeteredLRU[Key, Value]) Get(key Key) (value Value, ok bool) {
	value, ok = c.cache.Get(key)
	c.metrics.RecordLookup(ok)
	return value, ok
}
