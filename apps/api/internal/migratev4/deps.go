package migratev4

import (
	"fmt"
	"net/url"
	"regexp"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/cache"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
)

// DepsConfig is what building the nextgen services takes from the server's
// configuration.
type DepsConfig struct {
	MasterKeys          domain.MasterKeys
	Hashers             *crypto.HasherFactory
	BuiltinPublicBase   string
	SharedHosts         map[string]*regexp.Regexp
	SchemaCacheSize     int
	CrypterCacheSize    int
	SigningKeyCacheSize int
}

// NewDeps builds the nextgen services the migrator writes through, the way the
// server builds them for serving, minus everything HTTP. Schemas resolve from
// storage only: the v4 schema references nothing outside it.
func NewDeps(pool service.Pool, cfg DepsConfig) (Deps, error) {
	// The server's defaults, for a caller that leaves the sizes unset.
	const defaultCacheSize = 1000
	sizeOr := func(size int) int {
		if size <= 0 {
			return defaultCacheSize
		}
		return size
	}
	db := service.NewPool(pool)
	schemaCache, err := lru.New2Q[string, *jsonschema.Schema](sizeOr(cfg.SchemaCacheSize))
	if err != nil {
		return Deps{}, err
	}
	var builtinPublicBase *url.URL
	if cfg.BuiltinPublicBase != "" {
		if builtinPublicBase, err = url.Parse(cfg.BuiltinPublicBase); err != nil {
			return Deps{}, fmt.Errorf("parse the builtin public base: %w", err)
		}
	}
	schemaValidator, err := domain.NewSchemaValidator(cfg.BuiltinPublicBase)
	if err != nil {
		return Deps{}, err
	}
	builtinBases := domain.BuiltinSchemaBasesFor(cfg.BuiltinPublicBase)
	schemaStore := domain.WithBuiltinSchemaAliases(db.Statements(), builtinBases)
	resolver := domain.NewJSONSchemaResolver(schemaCache, 10, 0, nil, builtinPublicBase)

	crypters, err := cache.NewMeteredLRU[service.CrypterCacheKey, op.Crypto](cache.NameCrypter, sizeOr(cfg.CrypterCacheSize))
	if err != nil {
		return Deps{}, err
	}
	signingKeys, err := cache.NewMeteredLRU[service.SigningKeyCacheKey, domain.SigningKey](cache.NameSigningKey, sizeOr(cfg.SigningKeyCacheSize))
	if err != nil {
		return Deps{}, err
	}
	keys := service.NewKeyService(db, cfg.MasterKeys, crypters, signingKeys)

	policyEngine, err := policy.New()
	if err != nil {
		return Deps{}, err
	}
	hasher := cfg.Hashers.Default()
	passwords, err := service.NewPasswordPolicy(policyEngine, service.NewPolicyService(db, policyEngine), hasher, db)
	if err != nil {
		return Deps{}, err
	}
	return Deps{
		Pool:     db,
		Projects: service.NewProjectService(db, cfg.BuiltinPublicBase, schemaValidator, keys, cfg.Hashers, cfg.SharedHosts),
		Schemas:  service.NewSchemaService(db, resolver, schemaValidator, builtinBases),
		Flows:    service.NewFlowDefinitionService(db, schemaValidator, nil, builtinBases),
		Users: service.NewUserService(
			db,
			schemaStore,
			service.NewProjectHasherResolver(db, cfg.Hashers),
			passwords,
			service.StatementsUserRefResolver{Pool: db},
			builtinBases,
		),
		Variables:         service.NewVariableService(db, keys),
		IDPs:              service.NewIDPConnectionService(db, schemaValidator),
		SchemaStore:       schemaStore,
		Hasher:            hasher,
		BuiltinPublicBase: cfg.BuiltinPublicBase,
	}, nil
}
