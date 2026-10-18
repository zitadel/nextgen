package cell

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var (
	ErrNotParent        = errors.New("parent_not_accepting_children")
	ErrInvalidJoinToken = errors.New("invalid_join_token")
	ErrDuplicateChild   = errors.New("duplicate_child")
	ErrJoinWouldCycle   = errors.New("join_would_create_cycle")
	ErrInvalidChildURL  = errors.New("invalid_child_url")
	ErrUnknownChild     = errors.New("unknown_child")
	ErrUnauthorized     = errors.New("unauthorized")
)

const (
	JoinTokenTTL      = 60 * time.Second
	HeartbeatInterval = 5 * time.Second
	AliveWithin       = 15 * time.Second
)

type Store struct {
	db *sql.DB
}

type Meta struct {
	URL        string
	Label      string
	IsParent   bool
	ParentURL  string
	JoinSecret string
}

type Child struct {
	ChildURL   string
	SecretHash string
	LastSeenAt time.Time
}

func OpenStore(path, cellURL, label string, isParent bool) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.ensureMeta(cellURL, label, isParent); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT NOT NULL,
  label TEXT NOT NULL,
  is_parent INTEGER NOT NULL,
  parent_url TEXT NOT NULL DEFAULT '',
  join_secret TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS children (
  child_url TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS join_tokens (
  token TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);`)
	if err != nil {
		return err
	}
	if err := s.migrateProjects(); err != nil {
		return err
	}
	return s.migrateGrants()
}

func (s *Store) ensureMeta(cellURL, label string, isParent bool) error {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM meta`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	parent := 0
	if isParent {
		parent = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO meta(id, url, label, is_parent, parent_url, join_secret) VALUES (1, ?, ?, ?, '', '')`,
		NormalizeURL(cellURL), label, parent,
	)
	return err
}

func (s *Store) GetMeta() (Meta, error) {
	var m Meta
	var isParent int
	err := s.db.QueryRow(
		`SELECT url, label, is_parent, parent_url, join_secret FROM meta WHERE id = 1`,
	).Scan(&m.URL, &m.Label, &isParent, &m.ParentURL, &m.JoinSecret)
	m.IsParent = isParent == 1
	return m, err
}

func (s *Store) SetParent(parentURL, joinSecret string) error {
	_, err := s.db.Exec(
		`UPDATE meta SET parent_url = ?, join_secret = ? WHERE id = 1`,
		NormalizeURL(parentURL), joinSecret,
	)
	return err
}

func (s *Store) UpdateIdentity(cellURL, label string, isParent bool) error {
	parent := 0
	if isParent {
		parent = 1
	}
	_, err := s.db.Exec(
		`UPDATE meta SET url = ?, label = ?, is_parent = ? WHERE id = 1`,
		NormalizeURL(cellURL), label, parent,
	)
	return err
}

func (s *Store) CreateJoinToken(token string, expiresAt time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO join_tokens(token, expires_at, consumed_at) VALUES (?, ?, NULL)`,
		token, expiresAt.UTC().Format(time.RFC3339Nano),
	)
	return err
}

func (s *Store) ConsumeJoinToken(token string, now time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var expiresAt, consumedAt sql.NullString
	err = tx.QueryRow(
		`SELECT expires_at, consumed_at FROM join_tokens WHERE token = ?`, token,
	).Scan(&expiresAt, &consumedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidJoinToken
	}
	if err != nil {
		return err
	}
	if consumedAt.Valid && consumedAt.String != "" {
		return ErrInvalidJoinToken
	}
	exp, err := time.Parse(time.RFC3339Nano, expiresAt.String)
	if err != nil {
		return err
	}
	if !exp.After(now) {
		return ErrInvalidJoinToken
	}
	res, err := tx.Exec(
		`UPDATE join_tokens SET consumed_at = ? WHERE token = ? AND (consumed_at IS NULL OR consumed_at = '')`,
		now.UTC().Format(time.RFC3339Nano), token,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return ErrInvalidJoinToken
	}
	return tx.Commit()
}

func (s *Store) HasChild(childURL string) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM children WHERE child_url = ?`, NormalizeURL(childURL)).Scan(&n)
	return n > 0, err
}

func (s *Store) InsertChild(childURL, secretHash string, lastSeen time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO children(child_url, secret_hash, last_seen_at) VALUES (?, ?, ?)`,
		NormalizeURL(childURL), secretHash, lastSeen.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrDuplicateChild
	}
	return err
}

func (s *Store) ListChildren() ([]Child, error) {
	rows, err := s.db.Query(`SELECT child_url, secret_hash, last_seen_at FROM children ORDER BY child_url`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Child
	for rows.Next() {
		var c Child
		var seen string
		if err := rows.Scan(&c.ChildURL, &c.SecretHash, &seen); err != nil {
			return nil, err
		}
		c.LastSeenAt, err = time.Parse(time.RFC3339Nano, seen)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) FindChildBySecretHash(hash string) (Child, error) {
	var c Child
	var seen string
	err := s.db.QueryRow(
		`SELECT child_url, secret_hash, last_seen_at FROM children WHERE secret_hash = ?`, hash,
	).Scan(&c.ChildURL, &c.SecretHash, &seen)
	if errors.Is(err, sql.ErrNoRows) {
		return Child{}, ErrUnknownChild
	}
	if err != nil {
		return Child{}, err
	}
	c.LastSeenAt, err = time.Parse(time.RFC3339Nano, seen)
	return c, err
}

func (s *Store) TouchChild(childURL string, at time.Time) error {
	res, err := s.db.Exec(
		`UPDATE children SET last_seen_at = ? WHERE child_url = ?`,
		at.UTC().Format(time.RFC3339Nano), NormalizeURL(childURL),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrUnknownChild
	}
	return nil
}

func (s *Store) DeleteChild(childURL string) error {
	res, err := s.db.Exec(`DELETE FROM children WHERE child_url = ?`, NormalizeURL(childURL))
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrUnknownChild
	}
	return nil
}

func NormalizeURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return strings.TrimRight(raw, "/")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

func ValidateURL(raw string) (string, error) {
	n := NormalizeURL(raw)
	if n == "" {
		return "", ErrInvalidChildURL
	}
	u, err := url.Parse(n)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("%w: %s", ErrInvalidChildURL, raw)
	}
	return n, nil
}
