package crypto

import (
	"errors"
	"fmt"
	"time"
)

// ErrHashingBusy is returned by Hash and VerifyHash when no hashing slot freed
// up within the configured wait. It says nothing about the password: the
// caller must not count it as a failed attempt, and the client may retry.
var ErrHashingBusy = errors.New("too many passwords are being hashed right now")

// DefaultHashMemoryBudget is the memory the running hashes may need together
// when the configuration names no budget and the process has no memory limit
// to derive one from: enough for eight hashes at the default argon2id cost of
// 64 MiB.
const DefaultHashMemoryBudget = 512 << 20

// DefaultHashMaxWait is how long a hash waits for a slot when the
// configuration names no wait.
const DefaultHashMaxWait = time.Second

// HashConcurrencyConfig bounds how much password hashing runs at once. A
// password hash is the one request that is expensive by design, and the cost
// is set by configuration, not by the caller, so without a bound a burst of
// sign-ins is a burst of 64 MiB allocations and saturated cores. The bound is
// per process: every hasher the factory hands out shares it, and each server
// process has its own, so N replicas or serverless instances are N budgets.
type HashConcurrencyConfig struct {
	// MaxOperations caps the number of hashes running at once. Zero means
	// one per CPU the process may use, following runtime.GOMAXPROCS as the
	// runtime updates it, which is what a hash saturates.
	MaxOperations int `mapstructure:"max_operations"`
	// MemoryBudget is the bytes all running hashes may need together, so a
	// memory-hard hash takes a larger share of the slots than a cheap one.
	// Zero derives it: half of the Go memory limit (GOMEMLIMIT, which the
	// server sets from the container's cgroup limit) when one is set, else
	// [DefaultHashMemoryBudget].
	MemoryBudget int64 `mapstructure:"memory_budget"`
	// MaxWait is how long a hash waits for a slot before it is refused with
	// [ErrHashingBusy]. Zero means [DefaultHashMaxWait].
	MaxWait time.Duration `mapstructure:"max_wait"`
}

func (c HashConcurrencyConfig) validate() error {
	switch {
	case c.MaxOperations < 0:
		return fmt.Errorf("concurrency max_operations must not be negative, got %d", c.MaxOperations)
	case c.MemoryBudget < 0:
		return fmt.Errorf("concurrency memory_budget must not be negative, got %d", c.MemoryBudget)
	case c.MaxWait < 0:
		return fmt.Errorf("concurrency max_wait must not be negative, got %s", c.MaxWait)
	case c.MaxWait > 0 && c.MaxWait < time.Millisecond:
		// A bare YAML number decodes as nanoseconds, never through ParseDuration.
		return fmt.Errorf("concurrency max_wait %s is below 1ms; give it a unit, such as 1s", c.MaxWait)
	}
	return nil
}
