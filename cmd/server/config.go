package server

import (
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const Name = "zitadel/backend/v3/instrumentation/tracing"

type Config struct {
	Server          ServerConfig           `mapstructure:"server"`
	Database        database.Config        `mapstructure:"database"`
	PasswordHasher  crypto.HashConfig      `mapstructure:"password_hasher"`
	Schema          SchemaConfig           `mapstructure:"schema"`
	Session         service.SessionConfig  `mapstructure:"session"`
	Instrumentation instrumentation.Config `mapstructure:"instrumentation"`
}

func (c Config) Validate() error {
	for _, validate := range []func() error{
		c.Session.Validate,
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
	// EncryptionKeys is a collection of encryption keys used as KEK (key
	// encryption key) by the application. DEKs (data encryption key) will be
	// created by the application and encrypted with a KEK.
	//
	// This is a collection to enable encryption key rotation. Multiple keys
	// can be provided but only one should be marked to be used for encryption.
	// Once multiple keys are provided, all DEKs will be re-encrypted using the
	// KEK marked to use for encryption.
	//
	// If no encryption keys are provided, a default encryption key is created
	// in the kek directory. If there are no keys specified in the config but
	// files exist in the kek directory, the newest file is used for
	// encryption.
	EncryptionKeys []EncryptionKeyConfig `mapstructure:"encryption_keys"`

	ConsoleEnabled bool   `mapstructure:"console_enabled"`
	ConsolePath    string `mapstructure:"console_path"`
	LoginEnabled   bool   `mapstructure:"login_enabled"`
	LoginPath      string `mapstructure:"login_path"`
}

type SchemaConfig struct {
	BuiltinPublicBase string `mapstructure:"builtin_public_base"`
	LRUCacheSize      int    `mapstructure:"lru_cache_size"`
}

type EncryptionKeyConfig struct {
	// ID is the identifier by which JWEs can identify which encryption key
	// has been used to encrypt the data
	ID string `mapstructure:"id"`
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
