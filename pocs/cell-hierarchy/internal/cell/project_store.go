package cell

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrProjectExists      = errors.New("project_exists")
	ErrProjectNotFound    = errors.New("project_not_found")
	ErrProjectAttached    = errors.New("project_already_attached")
	ErrUserExists         = errors.New("user_exists")
	ErrLookupConflict     = errors.New("lookup_conflict")
	ErrLookupNotFound     = errors.New("lookup_not_found")
	ErrInvalidProjectID   = errors.New("invalid_project_id")
	ErrParentProjectMiss  = errors.New("parent_project_not_found")
	ErrLookupKeyRequired  = errors.New("lookup_key_required")
)

const (
	LookupStateLocal   = "local"
	LookupStatePushed  = "pushed"
	LookupStateVisible = "visible"
)

type Project struct {
	ID              string
	Name            string
	IsParent        bool
	LookupEnabled   bool
	ParentProjectID string
	ParentCellURL   string
	CreatedAt       time.Time
}

type User struct {
	ID        string
	ProjectID string
	Email     string
	CreatedAt time.Time
}

type LookupEntry struct {
	Key           string
	HomeProjectID string
	HomeCellURL   string
	State         string
	UpdatedAt     time.Time
}

func (s *Store) migrateProjects() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_parent INTEGER NOT NULL,
  lookup_enabled INTEGER NOT NULL,
  parent_project_id TEXT NOT NULL DEFAULT '',
  parent_cell_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, email)
);
CREATE TABLE IF NOT EXISTS lookup_entries (
  key TEXT PRIMARY KEY,
  home_project_id TEXT NOT NULL,
  home_cell_url TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`)
	return err
}

func NormalizeKey(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func (s *Store) CreateProject(p Project) error {
	id := strings.TrimSpace(p.ID)
	if id == "" {
		return ErrInvalidProjectID
	}
	isParent, lookup := 0, 0
	if p.IsParent {
		isParent = 1
	}
	if p.LookupEnabled {
		lookup = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO projects(id, name, is_parent, lookup_enabled, parent_project_id, parent_cell_url, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, p.Name, isParent, lookup,
		strings.TrimSpace(p.ParentProjectID), NormalizeURL(p.ParentCellURL),
		p.CreatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrProjectExists
	}
	return err
}

func (s *Store) GetProject(id string) (Project, error) {
	var p Project
	var isParent, lookup int
	var created string
	err := s.db.QueryRow(
		`SELECT id, name, is_parent, lookup_enabled, parent_project_id, parent_cell_url, created_at
		 FROM projects WHERE id = ?`, id,
	).Scan(&p.ID, &p.Name, &isParent, &lookup, &p.ParentProjectID, &p.ParentCellURL, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Project{}, ErrProjectNotFound
	}
	if err != nil {
		return Project{}, err
	}
	p.IsParent = isParent == 1
	p.LookupEnabled = lookup == 1
	p.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	return p, err
}

func (s *Store) ListProjects() ([]Project, error) {
	rows, err := s.db.Query(
		`SELECT id, name, is_parent, lookup_enabled, parent_project_id, parent_cell_url, created_at
		 FROM projects ORDER BY name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		var p Project
		var isParent, lookup int
		var created string
		if err := rows.Scan(&p.ID, &p.Name, &isParent, &lookup, &p.ParentProjectID, &p.ParentCellURL, &created); err != nil {
			return nil, err
		}
		p.IsParent = isParent == 1
		p.LookupEnabled = lookup == 1
		p.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) AttachProject(id, parentProjectID, parentCellURL string) error {
	p, err := s.GetProject(id)
	if err != nil {
		return err
	}
	if p.ParentProjectID != "" {
		return ErrProjectAttached
	}
	_, err = s.db.Exec(
		`UPDATE projects SET parent_project_id = ?, parent_cell_url = ? WHERE id = ?`,
		strings.TrimSpace(parentProjectID), NormalizeURL(parentCellURL), id,
	)
	return err
}

func (s *Store) CreateUser(u User) error {
	_, err := s.db.Exec(
		`INSERT INTO users(id, project_id, email, created_at) VALUES (?, ?, ?, ?)`,
		u.ID, u.ProjectID, NormalizeKey(u.Email), u.CreatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrUserExists
	}
	return err
}

func (s *Store) ListUsers(projectID string) ([]User, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, email, created_at FROM users WHERE project_id = ? ORDER BY email`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		var created string
		if err := rows.Scan(&u.ID, &u.ProjectID, &u.Email, &created); err != nil {
			return nil, err
		}
		u.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) UpsertLookupLocal(key, homeProjectID, homeCellURL string, at time.Time) error {
	key = NormalizeKey(key)
	if key == "" {
		return ErrLookupKeyRequired
	}
	existing, err := s.GetLookup(key)
	if err == nil {
		if existing.HomeProjectID != homeProjectID {
			return ErrLookupConflict
		}
		_, err = s.db.Exec(
			`UPDATE lookup_entries SET home_cell_url = ?, state = ?, updated_at = ? WHERE key = ?`,
			NormalizeURL(homeCellURL), LookupStateLocal, at.UTC().Format(time.RFC3339Nano), key,
		)
		return err
	}
	if !errors.Is(err, ErrLookupNotFound) {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO lookup_entries(key, home_project_id, home_cell_url, state, updated_at) VALUES (?, ?, ?, ?, ?)`,
		key, homeProjectID, NormalizeURL(homeCellURL), LookupStateLocal, at.UTC().Format(time.RFC3339Nano),
	)
	return err
}

func (s *Store) UpsertLookupVisible(key, homeProjectID, homeCellURL string, at time.Time) error {
	key = NormalizeKey(key)
	if key == "" {
		return ErrLookupKeyRequired
	}
	existing, err := s.GetLookup(key)
	if err == nil {
		if existing.HomeProjectID != homeProjectID {
			return ErrLookupConflict
		}
		_, err = s.db.Exec(
			`UPDATE lookup_entries SET home_cell_url = ?, state = ?, updated_at = ? WHERE key = ?`,
			NormalizeURL(homeCellURL), LookupStateVisible, at.UTC().Format(time.RFC3339Nano), key,
		)
		return err
	}
	if !errors.Is(err, ErrLookupNotFound) {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO lookup_entries(key, home_project_id, home_cell_url, state, updated_at) VALUES (?, ?, ?, ?, ?)`,
		key, homeProjectID, NormalizeURL(homeCellURL), LookupStateVisible, at.UTC().Format(time.RFC3339Nano),
	)
	return err
}

func (s *Store) MarkLookupPushed(key string, at time.Time) error {
	res, err := s.db.Exec(
		`UPDATE lookup_entries SET state = ?, updated_at = ? WHERE key = ?`,
		LookupStatePushed, at.UTC().Format(time.RFC3339Nano), NormalizeKey(key),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrLookupNotFound
	}
	return nil
}

func (s *Store) GetLookup(key string) (LookupEntry, error) {
	var e LookupEntry
	var updated string
	err := s.db.QueryRow(
		`SELECT key, home_project_id, home_cell_url, state, updated_at FROM lookup_entries WHERE key = ?`,
		NormalizeKey(key),
	).Scan(&e.Key, &e.HomeProjectID, &e.HomeCellURL, &e.State, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return LookupEntry{}, ErrLookupNotFound
	}
	if err != nil {
		return LookupEntry{}, err
	}
	e.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	return e, err
}

func (s *Store) ListLookupEntries() ([]LookupEntry, error) {
	rows, err := s.db.Query(
		`SELECT key, home_project_id, home_cell_url, state, updated_at FROM lookup_entries ORDER BY key`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LookupEntry
	for rows.Next() {
		var e LookupEntry
		var updated string
		if err := rows.Scan(&e.Key, &e.HomeProjectID, &e.HomeCellURL, &e.State, &updated); err != nil {
			return nil, err
		}
		e.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
