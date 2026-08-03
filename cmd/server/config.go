package server

import (
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const Name = "zitadel/backend/v3/instrumentation/tracing"

type Config struct {
	Server          ServerConfig           `mapstructure:"server"`
	Database        database.Config        `mapstructure:"database"`
	PasswordHasher  crypto.HashConfig      `mapstructure:"password_hasher"`
	Schema          SchemaConfig           `mapstructure:"schema"`
	Session         service.SessionConfig  `mapstructure:"session"`
	Instrumentation instrumentation.Config `mapstructure:"instrumentation"`
	Platform        PlatformConfig         `mapstructure:"platform"`
}

// PlatformConfig configures the deployment's default project resolution
// (Console ADR 0004). Portal-related keys (billing, support access) are
// intentionally absent until platform mode is implemented; this deployment
// always reports mode "standalone" for now.
type PlatformConfig struct {
	// ProjectID pins the deployment's default project to an existing
	// project. When empty (the default), a standalone deployment tracks its
	// first-created project — the one the customer's `zitadel setup`
	// creates. The server never creates a project itself, unless
	// BootstrapProject explicitly opts in (#605); a configured id that does
	// not exist is otherwise a startup error.
	ProjectID string `mapstructure:"project_id"`

	// BootstrapProject, when true, ensures the project pinned by ProjectID
	// exists at startup (idempotent insert). Off by default: no environment
	// gets a platform project created silently. Requires ProjectID. (#605)
	BootstrapProject bool `mapstructure:"bootstrap_project"`
}

func (c PlatformConfig) Validate() error {
	if c.BootstrapProject && c.ProjectID == "" {
		return errors.New("platform.bootstrap_project requires platform.project_id")
	}
	return nil
}

func (c Config) Validate() error {
	for _, validate := range []func() error{
		c.Session.Validate,
		c.Platform.Validate,
	} {
		if err := validate(); err != nil {
			return err
		}
	}
	return nil
}

type SessionConfig struct {
	DefaultTTL time.Duration `mapstructure:"default_ttl"`
	MaxTTL     time.Duration `mapstructure:"max_ttl"`
}

type ServerConfig struct {
	Address string `mapstructure:"address"`
	// DataDir is the local runtime root used by zero-config server defaults.
	// When unset, it defaults to a nextgen-data directory next to the binary.
	DataDir string `mapstructure:"data_dir"`
	// MasterKeys is a collection of master keys used by the application to wrap
	// the key encryption key (KEK) of every project. The KEKs themselves are
	// created by the application and stored encrypted in the database.
	//
	// This is a collection to enable master key rotation. Multiple keys can be
	// provided but only one should be marked to be used for encryption. Once
	// multiple keys are provided, all wrapped KEKs will be re-encrypted using
	// the master key marked to use for encryption.
	//
	// If no master keys are provided, a default master key is created in the
	// master key directory. If there are no keys specified in the config but
	// files exist in the master key directory, the newest file is used for
	// encryption.
	MasterKeys map[string]*MasterKeyConfig `mapstructure:"master_keys"`

	ConsoleEnabled bool   `mapstructure:"console_enabled"`
	ConsolePath    string `mapstructure:"console_path"`
	LoginEnabled   bool   `mapstructure:"login_enabled"`
	LoginPath      string `mapstructure:"login_path"`
}

type SchemaConfig struct {
	BuiltinPublicBase string `mapstructure:"builtin_public_base"`
	LRUCacheSize      int    `mapstructure:"lru_cache_size"`
}

type MasterKeyConfig struct {
	// File is the path to a file which contains the RSA private key in either a
	// JWK or a PEM file.
	//
	// Not required when PrivateKey is provided.
	// When PrivateKey is provided, File is ignored.
	File string `mapstructure:"file"`
	// UseForEncryption indicates whether this key should be used for
	// encryption. Exactly one key must be marked for encryption, otherwise the
	// application won't start.
	UseForEncryption bool `mapstructure:"use_for_encryption"`
	// PrivateKey is the RSA private key used to decrypt wrapped data.
	// It may be provided as PEM (including OpenSSH) or as a private JWK.
	PrivateKey string `mapstructure:"private_key"`
}
