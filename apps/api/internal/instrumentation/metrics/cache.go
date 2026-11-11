package metrics

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// A cache reports the three things that say whether it is earning its keep:
// how often it answers, how often it throws an entry away, and how full it is.
// Hit rate is deliberately not a fourth instrument. It is derived from the
// lookup counter, which carries the outcome as an attribute, so a dashboard
// computes it without a second series that can drift out of step with the
// first.
//
// Every cache reports the same three series and tells itself apart with the
// `cache` attribute. A dashboard written against one cache therefore reads all
// of them, and a new cache adds a label rather than a metric.
//
// Changing one of these names is a breaking change for whatever is graphing it.
const (
	CacheLookups   = "zitadel.cache.lookups"
	CacheEvictions = "zitadel.cache.evictions"
	CacheEntries   = "zitadel.cache.entries"
)

// CacheNameKey names the cache a measurement came from; ResultKey splits the
// lookup counter into hits and misses.
const (
	CacheNameKey = attribute.Key("cache")
	ResultKey    = attribute.Key("result")
)

// Cache is one cache's instruments. The zero value is not usable; build it
// with NewCache. A *Cache built with no meter provider is safe to call and
// records nothing, so callers never need a nil check around a record.
type Cache struct {
	lookups   metric.Int64Counter
	evictions metric.Int64Counter
	attrs     metric.MeasurementOption
	hit       metric.MeasurementOption
	miss      metric.MeasurementOption
}

// NewCache builds the instruments for the cache called name, reading size when
// the collector asks rather than on every write. That is what an observable
// gauge is for: a counter of live entries would have to be kept in step with
// eviction to stay honest, and a cache already knows its own length.
//
// An instrument that cannot be created is returned as an error rather than
// swallowed, because a cache that silently stopped being observable is the
// failure this package exists to catch.
func NewCache(name string, size func() int, opts ...Option) (*Cache, error) {
	m := meter(opts)

	lookups, err := m.Int64Counter(CacheLookups,
		metric.WithDescription("Cache lookups, split into hits and misses."))
	if err != nil {
		return nil, err
	}
	evictions, err := m.Int64Counter(CacheEvictions,
		metric.WithDescription("Entries dropped from a cache because it was full."))
	if err != nil {
		return nil, err
	}

	cacheAttr := CacheNameKey.String(name)
	entries, err := m.Int64ObservableGauge(CacheEntries,
		metric.WithDescription("Entries currently held in a cache."))
	if err != nil {
		return nil, err
	}
	if _, err := m.RegisterCallback(
		func(_ context.Context, observer metric.Observer) error {
			observer.ObserveInt64(entries, int64(size()), metric.WithAttributes(cacheAttr))
			return nil
		},
		entries,
	); err != nil {
		return nil, err
	}

	return &Cache{
		lookups:   lookups,
		evictions: evictions,
		attrs:     metric.WithAttributes(cacheAttr),
		hit:       metric.WithAttributes(cacheAttr, ResultKey.String("hit")),
		miss:      metric.WithAttributes(cacheAttr, ResultKey.String("miss")),
	}, nil
}

// RecordLookup counts one read, as a hit or a miss.
func (c *Cache) RecordLookup(hit bool) {
	outcome := c.miss
	if hit {
		outcome = c.hit
	}
	c.lookups.Add(context.Background(), 1, outcome)
}

// RecordAdd counts the eviction a write caused, if it caused one. Pass what the
// cache's own Add reported, so a cache that never evicts records nothing.
func (c *Cache) RecordAdd(evicted bool) {
	if evicted {
		c.evictions.Add(context.Background(), 1, c.attrs)
	}
}
