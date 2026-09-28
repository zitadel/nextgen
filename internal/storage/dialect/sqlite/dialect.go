package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"

	_ "modernc.org/sqlite" // register "sqlite" driver

	"github.com/zitadel/nextgen/internal/storage/database"
)

func init() {
	database.MustRegisterDialect("sqlite", DecodeConfig)
}

// memoryDBSeq gives each :memory: Connect a unique shared-cache name so
// independently opened pools in one process do not share a single database.
var memoryDBSeq atomic.Uint64

// Config holds the SQLite database path (or DSN).
type Config struct {
	// Path is a filesystem path to the database file, or ":memory:" for an
	// in-memory database. Directories are created on Connect (0o700); the DB
	// file and WAL/SHM siblings are tightened to 0o600 after open.
	// ":memory:" is process-local: each Connect gets an isolated shared-cache
	// database (unique URI name), not a process-wide singleton.
	Path string
	// DSN is a full modernc.org/sqlite DSN. When set, it takes precedence over
	// Path. Required pragmas from Path mode (_txlock, foreign_keys,
	// case_sensitive_like, …) are merged into the DSN when missing so callers
	// do not silently get SQLite defaults (FK off, case-insensitive LIKE).
	DSN string
}

// Connect implements [database.Dialect].
func (c Config) Connect(ctx context.Context) (database.Pool, error) {
	dsn, filePath, err := c.dsn()
	if err != nil {
		return nil, err
	}
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows one writer. A single connection serializes access in
	// database/sql and avoids SQLITE_BUSY_SNAPSHOT across pooled connections.
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	if filePath != "" {
		tightenDBFilePerms(filePath)
	}
	return newPool(sqlDB), nil
}

func (c Config) dsn() (dsn string, filePath string, err error) {
	if c.DSN != "" {
		merged, err := mergeSQLitePragmas(c.DSN)
		if err != nil {
			return "", "", err
		}
		return merged, "", nil
	}
	if c.Path == "" {
		return "", "", fmt.Errorf("sqlite: path or dsn is required")
	}
	if c.Path == ":memory:" {
		// Shared cache so multiple pool connections see the same in-memory DB;
		// unique name so separate Connect calls stay isolated.
		name := fmt.Sprintf("zitadel-%d", memoryDBSeq.Add(1))
		return "file:" + name + "?mode=memory&cache=shared&" + sqlitePragmaQuery, "", nil
	}
	dir := filepath.Dir(c.Path)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", "", fmt.Errorf("sqlite: create data directory: %w", err)
		}
	}
	// Absolute path in URI form; query params apply on every new connection
	// (connection-scoped pragmas like foreign_keys default OFF otherwise).
	abs, err := filepath.Abs(c.Path)
	if err != nil {
		return "", "", fmt.Errorf("sqlite: resolve path: %w", err)
	}
	u := &url.URL{
		Scheme:   "file",
		Path:     filepath.ToSlash(abs),
		RawQuery: sqlitePragmaQuery,
	}
	return u.String(), abs, nil
}

// mergeSQLitePragmas appends missing default pragma query params.
// Non-_pragma keys match by name; _pragma values match by pragma name
// (text before '(') so callers can override one without dropping the rest.
func mergeSQLitePragmas(dsn string) (string, error) {
	base, queryPart, hasQuery := strings.Cut(dsn, "?")
	existing := url.Values{}
	if hasQuery && queryPart != "" {
		var err error
		existing, err = url.ParseQuery(queryPart)
		if err != nil {
			return "", fmt.Errorf("sqlite: parse dsn query: %w", err)
		}
	}

	existingPragmaNames := make(map[string]struct{}, len(existing["_pragma"]))
	for _, v := range existing["_pragma"] {
		name, _, _ := strings.Cut(v, "(")
		existingPragmaNames[name] = struct{}{}
	}

	var missing []string
	for _, pair := range strings.Split(sqlitePragmaQuery, "&") {
		key, val, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		if key == "_pragma" {
			name, _, _ := strings.Cut(val, "(")
			if _, ok := existingPragmaNames[name]; ok {
				continue
			}
			missing = append(missing, pair)
			continue
		}
		if existing.Has(key) {
			continue
		}
		missing = append(missing, pair)
	}
	if len(missing) == 0 {
		return dsn, nil
	}
	added := strings.Join(missing, "&")
	if !hasQuery {
		return base + "?" + added, nil
	}
	if queryPart == "" {
		return base + "?" + added, nil
	}
	return base + "?" + queryPart + "&" + added, nil
}

func tightenDBFilePerms(path string) {
	_ = os.Chmod(path, 0o600)
	for _, suffix := range []string{"-wal", "-shm"} {
		_ = os.Chmod(path+suffix, 0o600)
	}
}

// _txlock=immediate acquires the write lock at BEGIN so deferred read
// transactions cannot upgrade into SQLITE_BUSY_SNAPSHOT after another writer
// commits. busy_timeout covers remaining lock waits if MaxOpenConns is raised.
// Pragmas are applied via DSN so every opened connection gets them.
const sqlitePragmaQuery = "_txlock=immediate&_pragma=busy_timeout(30000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=case_sensitive_like(1)"

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
