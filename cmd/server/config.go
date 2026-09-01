package server

import (
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
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
	Platform        PlatformConfig         `mapstructure:"platform"`
	Events          EventsConfig           `mapstructure:"events"`
}

// EventsConfig configures audit event retention and deployment export sinks.
type EventsConfig struct {
	Retention audit.RetentionConfig `mapstructure:"retention"`
	Export    audit.ExportConfig    `mapstructure:"export"`
}

// PlatformConfig configures the deployment's default project resolution
// (Console ADR 0004). Portal-related keys (billing, support access) are
// intentionally absent until platform mode is implemented; this deployment
// always reports mode "standalone" for now.
type PlatformConfig struct {
	// ProjectID pins a standalone deployment's default project to an existing
	// project (an id of the form "proj_<...>"). When empty (the default), the
	// deployment tracks its first-created project — the one the customer's
	// `zitadel setup` creates. The server never creates that project itself; a
	// configured id that does not exist is a startup error. Leave empty when
	// BootstrapProject is set — the platform project's id is server-owned
	// (domain.PlatformProjectID), not operator-authored. (#605)
	ProjectID string `mapstructure:"project_id"`

	// BootstrapProject, when true, ensures the well-known platform project
	// (domain.PlatformProjectID) exists at startup (idempotent insert) and
	// resolves it as the default. Off by default: no environment gets a
	// platform project created silently. Needs no ProjectID. (#605)
	BootstrapProject bool `mapstructure:"bootstrap_project"`
}

func (c PlatformConfig) Validate() error {
	if c.ProjectID != "" && !domain.PrefixProject.Matches(c.ProjectID) {
		return fmt.Errorf("platform.project_id %q must be a project id of the form %q",
			c.ProjectID, domain.PrefixProject.IDPrefix("<id>"))
	}
	if c.BootstrapProject && c.ProjectID != "" && c.ProjectID != domain.PlatformProjectID {
		return fmt.Errorf("platform.bootstrap_project uses the built-in id %q; leave platform.project_id empty or set it to that value",
			domain.PlatformProjectID)
	}
	return nil
}

// ResolvedProjectID is the id the deployment pins its default project to: the
// built-in platform id when bootstrapping, else the operator's pin.
func (c PlatformConfig) ResolvedProjectID() string {
	if c.BootstrapProject {
		return domain.PlatformProjectID
	}
	return c.ProjectID
}

// ProvisioningProjectID is the project that receives platform-plane
// provisioning side effects (personal teams, #527): the built-in platform id
// when bootstrap_project opted in, empty otherwise — and an empty id turns
// the provisioning into a universal no-op.
//
// Deliberately NOT ResolvedProjectID: a standalone deployment that pins
// platform.project_id is naming its console default project (Console ADR
// 0004 §2), not opting into the platform plane — and its end-user
// registrations must not mint personal teams. BootstrapProject is the one
// explicit opt-in (#736), extending #605's rule that no environment gets
// platform provisioning silently.
func (c PlatformConfig) ProvisioningProjectID() string {
	if c.BootstrapProject {
		return domain.PlatformProjectID
	}
	return ""
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
