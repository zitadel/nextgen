package jobs

import "time"

// Config holds process-local Engine knobs (ADR 065 §9).
type Config struct {
	Concurrency       int           `mapstructure:"concurrency"`
	PollInterval      time.Duration `mapstructure:"poll_interval"`
	TakeBatchSize     int           `mapstructure:"take_batch_size"`
	LeaseDuration     time.Duration `mapstructure:"lease_duration"`
	HeartbeatInterval time.Duration `mapstructure:"heartbeat_interval"`
	MaxAttempts       int           `mapstructure:"max_attempts"`
	BackoffCap        time.Duration `mapstructure:"backoff_cap"`
	Retain            time.Duration `mapstructure:"retain"`
	// TriggerSecret, when set, means Cron drain owns the wake: Start does not
	// run the poll loop (same idea as events.retention.trigger_secret).
	TriggerSecret string `mapstructure:"trigger_secret"`
	// LeaseBy is written on Take as lease_by. Empty defaults to "engine".
	LeaseBy string `mapstructure:"lease_by"`
}

// DefaultConfig returns ADR 065 defaults.
func DefaultConfig() Config {
	return Config{
		Concurrency:       1,
		PollInterval:      time.Second,
		TakeBatchSize:     1,
		LeaseDuration:     30 * time.Second,
		HeartbeatInterval: 10 * time.Second,
		MaxAttempts:       5,
		BackoffCap:        time.Hour,
		Retain:            7 * 24 * time.Hour,
		LeaseBy:           "engine",
	}
}

func applyDefaults(cfg Config) Config {
	def := DefaultConfig()
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = def.Concurrency
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = def.PollInterval
	}
	if cfg.TakeBatchSize <= 0 {
		cfg.TakeBatchSize = def.TakeBatchSize
	}
	if cfg.LeaseDuration <= 0 {
		cfg.LeaseDuration = def.LeaseDuration
	}
	if cfg.HeartbeatInterval <= 0 {
		cfg.HeartbeatInterval = def.HeartbeatInterval
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = def.MaxAttempts
	}
	if cfg.BackoffCap <= 0 {
		cfg.BackoffCap = def.BackoffCap
	}
	if cfg.Retain <= 0 {
		cfg.Retain = def.Retain
	}
	if cfg.LeaseBy == "" {
		cfg.LeaseBy = def.LeaseBy
	}
	return cfg
}

// WorkerOpts tunes one registered handler. Zero values mean Engine defaults.
type WorkerOpts struct {
	// Timeout bounds one Perform. Zero means no extra deadline beyond the
	// caller's context.
	Timeout time.Duration
}
