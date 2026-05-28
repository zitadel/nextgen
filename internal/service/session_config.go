package service

import (
	"fmt"
	"time"
)

// SessionConfig holds server-wide session TTL settings for exchange.
type SessionConfig struct {
	DefaultTTL time.Duration
	MaxTTL     time.Duration
}

// Validate checks session TTL configuration at startup.
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
	return nil
}

// TestSessionConfig returns fixed TTL bounds for unit and integration tests.
func TestSessionConfig() SessionConfig {
	return SessionConfig{
		DefaultTTL: time.Hour,
		MaxTTL:     24 * time.Hour,
	}
}
