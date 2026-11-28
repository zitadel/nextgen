package cache

import (
	"errors"
	"time"

	"github.com/hashicorp/golang-lru/v2/expirable"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

type MeteredExpirableLRU[Key comparable, Value any] struct {
	cache   *expirable.LRU[Key, Value]
	metrics *metrics.Cache
}

func NewMeteredExpirableLRU[Key comparable, Value any](name string, size int, ttl time.Duration, opts ...metrics.Option) (*MeteredExpirableLRU[Key, Value], error) {
	if size <= 0 {
		return nil, errors.New("must provide a positive size")
	}
	if ttl <= 0 {
		return nil, errors.New("must provide a positive ttl")
	}
	cache := expirable.NewLRU[Key, Value](size, nil, ttl)
	instruments, err := metrics.NewCache(name, cache.Len, opts...)
	if err != nil {
		return nil, err
	}
	return new(MeteredExpirableLRU[Key, Value]{cache: cache, metrics: instruments}), nil
}

func (c MeteredExpirableLRU[Key, Value]) Add(key Key, value Value) (evicted bool) {
	evicted = c.cache.Add(key, value)
	c.metrics.RecordAdd(evicted)
	return evicted
}

func (c MeteredExpirableLRU[Key, Value]) Get(key Key) (value Value, ok bool) {
	value, ok = c.cache.Get(key)
	c.metrics.RecordLookup(ok)
	return value, ok
}
