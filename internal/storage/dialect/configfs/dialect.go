package configfs

import (
	"context"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/sqlite"
)

// DialectName is the value a deployment configures to serve its configuration
// resources from a project directory.
const DialectName = "configfs"

func init() {
	database.MustRegisterDialect(DialectName, DecodeConfig)
}

// Config points the server at a project directory and the SQL database behind
// it.
//
// It composes rather than replaces: `sqlite` is the ordinary SQLite config, and
// everything that is not a CLI-authored configuration resource lives there
// exactly as it would without this dialect.
type Config struct {
	// Path is the project directory — the one holding `zitadel.json` and
	// `.zitadel/`, which is the directory `zitadel setup` was run in. Neither
	// has to exist yet: the server follows the directory, so a project set up
	// after the server starts is picked up without a restart.
	Path string
	// SQLite is the backing store for every other resource.
	SQLite sqlite.Config
}

// Name implements [database.Dialect].
func (c Config) Name() string { return DialectName }

// Connect implements [database.Dialect].
func (c Config) Connect(ctx context.Context) (database.Pool, error) {
	if strings.TrimSpace(c.Path) == "" {
		return nil, fmt.Errorf("configfs: path to the project directory is required")
	}

	sqlPool, err := c.SQLite.Connect(ctx)
	if err != nil {
		return nil, fmt.Errorf("configfs: connect the backing database: %w", err)
	}
	typed, ok := sqlPool.(SQLPool)
	if !ok {
		_ = sqlPool.Close(ctx)
		return nil, fmt.Errorf("configfs: backing pool %T cannot serve statements", sqlPool)
	}

	// The store outlives this call: it watches the directory for the life of
	// the pool, and ctx is what stops it.
	store, err := NewStore(ctx, c.Path)
	if err != nil {
		_ = sqlPool.Close(ctx)
		return nil, err
	}

	return NewPool(typed, store), nil
}

// DecodeConfig implements [database.DialectDecoder].
//
// A bare string is the project directory, with the database defaulted beneath
// it, so the shortest useful configuration is one line:
//
//	database:
//	  configfs: ./my-app
func DecodeConfig(input any) (database.Dialect, error) {
	switch v := input.(type) {
	case string:
		path := strings.TrimSpace(v)
		if path == "" {
			return nil, database.ErrInvalidDialectConfig(input)
		}
		return Config{Path: path, SQLite: defaultSQLite(path)}, nil

	case map[string]any:
		cfg := Config{}
		if path, ok := v["path"].(string); ok {
			cfg.Path = strings.TrimSpace(path)
		}
		if cfg.Path == "" {
			return nil, database.ErrInvalidDialectConfig(input)
		}

		// The nested sqlite block is the ordinary one, decoded by its own
		// dialect so the two stay in step rather than growing a second parser.
		if nested, ok := v["sqlite"]; ok {
			dialect, err := sqlite.DecodeConfig(nested)
			if err != nil {
				return nil, err
			}
			sqliteCfg, ok := dialect.(sqlite.Config)
			if !ok {
				return nil, database.ErrInvalidDialectConfig(input)
			}
			cfg.SQLite = sqliteCfg
		} else {
			cfg.SQLite = defaultSQLite(cfg.Path)
		}
		return cfg, nil

	default:
		return nil, database.ErrInvalidDialectConfig(input)
	}
}

// localDir is the one part of `.zitadel` that is machine-local. `zitadel setup`
// writes it to .gitignore; everything else under `.zitadel` is configuration a
// developer commits.
const localDir = zitadelDir + "/local"

// defaultSQLite puts the database under `.zitadel/local`, not `.zitadel`
// itself.
//
// The directory holding the configuration is committed — that is the point of
// authoring it as files — so a database placed beside it would be committed
// too, and a SQLite file in source control is a merge conflict waiting to
// happen. `.zitadel/local` is the directory setup already gitignores for
// exactly this class of state.
func defaultSQLite(projectPath string) sqlite.Config {
	return sqlite.Config{Path: projectPath + "/" + localDir + "/zitadel.db"}
}

var _ database.Dialect = (*Config)(nil)
