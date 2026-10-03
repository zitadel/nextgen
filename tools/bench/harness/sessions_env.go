package harness

import (
	"fmt"
	"strconv"
	"time"
)

// Environment variables carrying the session cache settings into a k6
// process, next to the Target's.
const (
	EnvSessionAffinity = "NEXTGEN_SESSION_AFFINITY"
	EnvSessionMargin   = "NEXTGEN_SESSION_MARGIN"
	EnvSessionCapacity = "NEXTGEN_SESSION_CAPACITY"
	EnvSessionTTL      = "NEXTGEN_SESSION_TTL"
)

// SessionSettings are the run's choices about sessions. The zero value means
// the cache defaults and the server's default session lifetime.
type SessionSettings struct {
	Affinity Affinity
	Margin   time.Duration
	Capacity int
	// TTL asks the handoff exchange for this session lifetime. Zero leaves
	// the server default, which is what deployments run; a shorter one is for
	// watching rotation within minutes, and is recorded as a setting.
	TTL time.Duration
}

// Env renders the settings as environment, omitting what is left to default.
func (s SessionSettings) Env() map[string]string {
	env := map[string]string{}
	if s.Affinity != "" {
		env[EnvSessionAffinity] = string(s.Affinity)
	}
	if s.Margin > 0 {
		env[EnvSessionMargin] = s.Margin.String()
	}
	if s.Capacity > 0 {
		env[EnvSessionCapacity] = strconv.Itoa(s.Capacity)
	}
	if s.TTL > 0 {
		env[EnvSessionTTL] = s.TTL.String()
	}
	return env
}

// Validate reports a setting the cache cannot honour.
func (s SessionSettings) Validate() error {
	switch s.Affinity {
	case "", AffinityShared, AffinityVU:
	default:
		return fmt.Errorf("session affinity %q: want %q or %q", s.Affinity, AffinityShared, AffinityVU)
	}
	if s.TTL > 0 && s.Margin > 0 && s.TTL <= s.Margin {
		return fmt.Errorf("session ttl %s is not longer than the refresh margin %s", s.TTL, s.Margin)
	}
	return nil
}

// SessionSettingsFromEnv reads the settings back.
func SessionSettingsFromEnv(lookup func(string) (string, bool)) (SessionSettings, error) {
	var s SessionSettings
	if v, ok := lookup(EnvSessionAffinity); ok && v != "" {
		s.Affinity = Affinity(v)
	}
	if v, ok := lookup(EnvSessionMargin); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return s, fmt.Errorf("%s: %w", EnvSessionMargin, err)
		}
		s.Margin = d
	}
	if v, ok := lookup(EnvSessionCapacity); ok && v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return s, fmt.Errorf("%s: %w", EnvSessionCapacity, err)
		}
		s.Capacity = n
	}
	if v, ok := lookup(EnvSessionTTL); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return s, fmt.Errorf("%s: %w", EnvSessionTTL, err)
		}
		s.TTL = d
	}
	return s, s.Validate()
}

// CacheConfig converts the settings to a cache configuration.
func (s SessionSettings) CacheConfig() SessionCacheConfig {
	return SessionCacheConfig{Capacity: s.Capacity, Margin: s.Margin, Affinity: s.Affinity}
}
