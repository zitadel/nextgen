package server

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/serviceping"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const Name = "zitadel/backend/v3/instrumentation/tracing"

type Config struct {
	Server          ServerConfig           `mapstructure:"server"`
	Database        database.Config        `mapstructure:"database"`
	PasswordHasher  crypto.HashConfig      `mapstructure:"password_hasher"`
	Schema          SchemaConfig           `mapstructure:"schema"`
	Keys            KeysConfig             `mapstructure:"keys"`
	Session         service.SessionConfig  `mapstructure:"session"`
	Instrumentation instrumentation.Config `mapstructure:"instrumentation"`
	Platform        PlatformConfig         `mapstructure:"platform"`
	Events          EventsConfig           `mapstructure:"events"`
	// HTTPClient configures the hardened egress client used for every fetch
	// of a URL a platform user can inject (see the egress-policy ADR).
	HTTPClient httputil.ClientConfig `mapstructure:"httpclient"`
	// Origins configures write validation for project origin patterns.
	Origins OriginsConfig `mapstructure:"origins"`
	// ServicePing reports the deployment's version and dialect to Vercel
	// Web Analytics, and to Mixpanel given a token (off by default).
	ServicePing serviceping.Config `mapstructure:"service_ping"`
}

// OriginsConfig is the instance-level origins policy. SharedHosts maps a shared
// host suffix to a full-hostname allow regexp. YAML values are strings; the
// config decode hook compiles them into *regexp.Regexp.
type OriginsConfig struct {
	SharedHosts map[string]*regexp.Regexp `mapstructure:"shared_hosts"`
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
	// deployment tracks its first-created project other than the built-in
	// platform row — the one the customer's `zitadel setup` creates; the
	// platform project is infrastructure and only becomes the default through
	// this pin or BootstrapProject. The server never creates that project
	// itself; a configured id that does not exist is a startup error. Leave
	// empty when BootstrapProject is set — the platform project's id is
	// server-owned (domain.PlatformProjectID), not operator-authored. (#605)
	ProjectID string `mapstructure:"project_id"`

	// BootstrapProject, when true, ensures the well-known platform project
	// (domain.PlatformProjectID) exists at startup (idempotent insert) and
	// resolves it as the default. Off by default: no environment gets a
	// platform project created silently. Needs no ProjectID. (#605)
	BootstrapProject bool `mapstructure:"bootstrap_project"`

	// Operators lists, by id, the platform-project users who hold
	// platform.operator and so administer every project of the deployment
	// (ADR 075). The server reconciles it at startup: it grants every listed
	// user that exists and revokes what an earlier list granted. Needs a
	// platform project, from BootstrapProject or ProjectID.
	Operators []string `mapstructure:"operators"`
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
	for _, id := range c.Operators {
		if !domain.PrefixUser.Matches(id) {
			return fmt.Errorf("platform.operators: %q must be a user id of the form %q",
				id, domain.PrefixUser.IDPrefix("<id>"))
		}
	}
	if len(c.Operators) > 0 && c.ResolvedProjectID() == "" {
		return errors.New("platform.operators needs a platform project: set platform.bootstrap_project or platform.project_id")
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
		c.Server.Validate,
		c.Session.Validate,
		c.Platform.Validate,
		c.HTTPClient.Validate,
		c.Schema.Validate,
		c.Events.Retention.Validate,
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
	// GenerateMasterKey allows the server to mint a master key when it starts
	// with none configured and none in the master key directory. It defaults to
	// true, which is what makes a first local start work with no configuration
	// at all.
	//
	// Turn it off wherever a generated key would be the wrong answer rather
	// than a convenience: on ephemeral storage every instance would mint its
	// own key, and project KEKs wrapped by one of them cannot be unwrapped by
	// the next. With it off, a missing key fails the start instead, which is
	// the failure that can still be recovered from.
	GenerateMasterKey bool `mapstructure:"generate_master_key"`

	ConsoleEnabled bool   `mapstructure:"console_enabled"`
	ConsolePath    string `mapstructure:"console_path"`
	// PublicBase is the origin this deployment is reachable at from a browser.
	// It only feeds user-facing URLs (claim and dashboard); schema identity
	// stays on schema.builtin_public_base, which is an identifier namespace,
	// not an address.
	PublicBase string `mapstructure:"public_base"`
	// ConsoleOrigins are origins the console is also reached at, beside the
	// origin of PublicBase, such as another hostname in front of the same
	// deployment. Opening a flow from one is exempt from a project's origins,
	// as from PublicBase's.
	ConsoleOrigins []string `mapstructure:"console_origins"`
	// RequestIDHeader names a header that a proxy in front of the server sets
	// to its own ID for each request, such as Vercel's x-vercel-id. The server
	// then uses that ID as the request ID, so its logs, events and error pages
	// quote the ID the proxy's logs show. Empty, the server mints its own. Set
	// it only behind a proxy that overwrites the header: otherwise a client
	// chooses its own request ID.
	RequestIDHeader string `mapstructure:"request_id_header"`
}

func (c ServerConfig) Validate() error {
	// ensure there are no path collisions between idp callbacks and the console path
	if !c.ConsoleEnabled {
		return nil
	}
	for _, prefix := range api.IDPCallbackPathPrefixes() {
		if c.ConsolePath == prefix || strings.HasPrefix(c.ConsolePath, prefix+"/") {
			return fmt.Errorf("server.console_path %q must not be %s or under it: the path is reserved for the sign-in provider callback", c.ConsolePath, prefix)
		}
	}
	return nil
}

// KeysConfig sizes the in-process key caches. Both are read-through and hold
// values, so the only cost of a larger cache is memory; the only cost of a
// smaller one is a database read on the miss.
type KeysConfig struct {
	// CrypterLRUCacheSize bounds the cache of resolved crypters held by key id
	// and algorithm. A key's material never changes, so an entry never needs
	// invalidating.
	CrypterLRUCacheSize int `mapstructure:"crypter_lru_cache_size"`
	// SigningKeyLRUCacheSize bounds the cache of active signing keys held by
	// project and purpose. Nothing retires a signing key today; once something
	// does, this cache needs an eviction path (see GetProjectSigningKey).
	SigningKeyLRUCacheSize int `mapstructure:"signing_key_lru_cache_size"`
}

type SchemaConfig struct {
	BuiltinPublicBase string `mapstructure:"builtin_public_base"`
	LRUCacheSize      int    `mapstructure:"lru_cache_size"`
	// ResolveTimeout bounds one whole schema ingest including every $ref it
	// follows, so recursion depth cannot multiply the per-request
	// httpclient.timeout into sequential waits.
	ResolveTimeout time.Duration `mapstructure:"resolve_timeout"`
}

func (c SchemaConfig) Validate() error {
	// A negative value would reach context.WithTimeout and fail every
	// uncached ingest at runtime instead of failing the boot.
	if c.ResolveTimeout < 0 {
		return fmt.Errorf("schema.resolve_timeout must not be negative, got %s", c.ResolveTimeout)
	}
	return nil
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
