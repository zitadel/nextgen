package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite" // register "sqlite" driver

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func init() {
	database.MustRegisterDialect("sqlite", DecodeConfig)
}

// Config holds the SQLite database path (or DSN).
type Config struct {
	// Path is a filesystem path to the database file. Directories are created
	// on Connect. Prefer this for zero-config / config YAML.
	Path string
	// DSN is a full modernc.org/sqlite DSN. When set, it takes precedence over Path.
	DSN string
}

// Connect implements [database.Dialect].
func (c Config) Connect(ctx context.Context) (database.Pool, error) {
	dsn, err := c.dsn()
	if err != nil {
		return nil, err
	}
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows one writer; keep the pool small and rely on busy_timeout.
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(4)
	if err := applyPragmas(ctx, sqlDB); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return newPool(sqlDB), nil
}

func (c Config) dsn() (string, error) {
	if c.DSN != "" {
		return c.DSN, nil
	}
	if c.Path == "" {
		return "", fmt.Errorf("sqlite: path or dsn is required")
	}
	if c.Path == ":memory:" {
		// Shared cache so multiple pool connections see the same in-memory DB.
		return "file:zitadel?mode=memory&cache=shared&" + sqlitePragmaQuery, nil
	}
	dir := filepath.Dir(c.Path)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", fmt.Errorf("sqlite: create data directory: %w", err)
		}
	}
	// Absolute path in URI form; query params apply on every new connection
	// (connection-scoped pragmas like foreign_keys default OFF otherwise).
	abs, err := filepath.Abs(c.Path)
	if err != nil {
		return "", fmt.Errorf("sqlite: resolve path: %w", err)
	}
	return "file:" + filepath.ToSlash(abs) + "?" + sqlitePragmaQuery, nil
}

const sqlitePragmaQuery = "_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"

func applyPragmas(ctx context.Context, sqlDB *sql.DB) error {
	// Belt-and-suspenders for the connection(s) already in the pool; DSN
	// pragmas cover subsequent opens.
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
		"PRAGMA synchronous=NORMAL",
	} {
		if _, err := sqlDB.ExecContext(ctx, pragma); err != nil {
			return fmt.Errorf("sqlite: %s: %w", pragma, err)
		}
	}
	return nil
}

// Name implements [database.Dialect].
func (c Config) Name() string {
	return "sqlite"
}

var _ database.Dialect = Config{}

// DecodeConfig parses a SQLite path string or a map with "path" / "dsn".
func DecodeConfig(input any) (database.Dialect, error) {
	switch v := input.(type) {
	case string:
		v = strings.TrimSpace(v)
		if v == "" {
			return nil, database.ErrInvalidDialectConfig(input)
		}
		return Config{Path: v}, nil
	case map[string]any:
		cfg := Config{}
		if path, ok := v["path"].(string); ok {
			cfg.Path = path
		}
		if dsn, ok := v["dsn"].(string); ok {
			cfg.DSN = dsn
		}
		if cfg.Path == "" && cfg.DSN == "" {
			return nil, database.ErrInvalidDialectConfig(input)
		}
		return cfg, nil
	default:
		return nil, database.ErrInvalidDialectConfig(input)
	}
}
