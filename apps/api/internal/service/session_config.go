package service

import (
	"fmt"
	"time"
)

// SessionConfig holds server-wide session TTL settings for exchange and the
// sessions.gc sweeper (#881).
type SessionConfig struct {
	DefaultTTL time.Duration    `mapstructure:"default_ttl"`
	MaxTTL     time.Duration    `mapstructure:"max_ttl"`
	GC         SessionsGCConfig `mapstructure:"gc"`
}

// Validate checks session TTL and GC configuration at startup.
func (c SessionConfig) Validate() error {
	if c.DefaultTTL <= 0 {
		return fmt.Errorf("session default_ttl must be positive")
	}
	if c.MaxTTL <= 0 {
		return fmt.Errorf("session max_ttl must be positive")
	}
	if c.DefaultTTL > c.MaxTTL {
		return fmt.Errorf("session default_ttl must not exceed max_ttl")
	}
	return c.GC.Validate()
}
