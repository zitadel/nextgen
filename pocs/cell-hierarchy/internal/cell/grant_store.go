package cell

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrAppExists         = errors.New("app_exists")
	ErrAppNotFound       = errors.New("app_not_found")
	ErrTupleExists       = errors.New("tuple_exists")
	ErrTupleNotFound     = errors.New("tuple_not_found")
	ErrInterestExists    = errors.New("interest_exists")
	ErrInvalidAppName    = errors.New("invalid_app_name")
	ErrInvalidRelation   = errors.New("invalid_relation")
	ErrInvalidObject     = errors.New("invalid_object")
	ErrSubjectRequired   = errors.New("subject_required")
	ErrPrincipalNotFound = errors.New("principal_not_found")
)

type App struct {
	ID        string
	ProjectID string
	Name      string
	CreatedAt time.Time
}

type Tuple struct {
	ID            string
	ProjectID     string
	Object        string
	Relation      string
	UserKey       string
	HomeProjectID string
	HomeCellURL   string
	CreatedAt     time.Time
}

func (t Tuple) Subject() string {
	return fmt.Sprintf("user:%s@%s@%s", t.UserKey, t.HomeProjectID, t.HomeCellURL)
}

type Interest struct {
	ID                  string
	PrincipalKey        string
	HomeProjectID       string
	SubscriberCellURL   string
	SubscriberProjectID string
	TupleID             string
	Object              string
	Relation            string
	CreatedAt           time.Time
}

func (s *Store) migrateGrants() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);
CREATE TABLE IF NOT EXISTS tuples (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  object TEXT NOT NULL,
  relation TEXT NOT NULL,
  user_key TEXT NOT NULL,
  home_project_id TEXT NOT NULL,
  home_cell_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, object, relation, user_key)
);
CREATE TABLE IF NOT EXISTS interests (
  id TEXT PRIMARY KEY,
  principal_key TEXT NOT NULL,
  home_project_id TEXT NOT NULL,
  subscriber_cell_url TEXT NOT NULL,
  subscriber_project_id TEXT NOT NULL,
  tuple_id TEXT NOT NULL,
  object TEXT NOT NULL DEFAULT '',
  relation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(principal_key, subscriber_project_id, tuple_id)
);`)
	return err
}

func (s *Store) CreateApp(a App) error {
	name := strings.TrimSpace(a.Name)
	if name == "" {
		return ErrInvalidAppName
	}
	_, err := s.db.Exec(
		`INSERT INTO apps(id, project_id, name, created_at) VALUES (?, ?, ?, ?)`,
		a.ID, a.ProjectID, name, a.CreatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrAppExists
	}
	return err
}

func (s *Store) GetApp(projectID, id string) (App, error) {
	var a App
	var created string
	err := s.db.QueryRow(
		`SELECT id, project_id, name, created_at FROM apps WHERE project_id = ? AND id = ?`,
		projectID, id,
	).Scan(&a.ID, &a.ProjectID, &a.Name, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return App{}, ErrAppNotFound
	}
	if err != nil {
		return App{}, err
	}
	a.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	return a, err
}

func (s *Store) GetAppByName(projectID, name string) (App, error) {
	var a App
	var created string
	err := s.db.QueryRow(
		`SELECT id, project_id, name, created_at FROM apps WHERE project_id = ? AND name = ?`,
		projectID, strings.TrimSpace(name),
	).Scan(&a.ID, &a.ProjectID, &a.Name, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return App{}, ErrAppNotFound
	}
	if err != nil {
		return App{}, err
	}
	a.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	return a, err
}

func (s *Store) ListApps(projectID string) ([]App, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, name, created_at FROM apps WHERE project_id = ? ORDER BY name`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []App
	for rows.Next() {
		var a App
		var created string
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.Name, &created); err != nil {
			return nil, err
		}
		a.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) DeleteApp(projectID, id string) error {
	res, err := s.db.Exec(`DELETE FROM apps WHERE project_id = ? AND id = ?`, projectID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrAppNotFound
	}
	return nil
}

func (s *Store) CreateTuple(t Tuple) error {
	obj := strings.TrimSpace(t.Object)
	rel := strings.TrimSpace(t.Relation)
	key := NormalizeKey(t.UserKey)
	if obj == "" {
		return ErrInvalidObject
	}
	if rel == "" {
		return ErrInvalidRelation
	}
	if key == "" || t.HomeProjectID == "" || t.HomeCellURL == "" {
		return ErrSubjectRequired
	}
	_, err := s.db.Exec(
		`INSERT INTO tuples(id, project_id, object, relation, user_key, home_project_id, home_cell_url, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.ProjectID, obj, rel, key, t.HomeProjectID, NormalizeURL(t.HomeCellURL),
		t.CreatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrTupleExists
	}
	return err
}

func (s *Store) GetTuple(id string) (Tuple, error) {
	var t Tuple
	var created string
	err := s.db.QueryRow(
		`SELECT id, project_id, object, relation, user_key, home_project_id, home_cell_url, created_at
		 FROM tuples WHERE id = ?`, id,
	).Scan(&t.ID, &t.ProjectID, &t.Object, &t.Relation, &t.UserKey, &t.HomeProjectID, &t.HomeCellURL, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Tuple{}, ErrTupleNotFound
	}
	if err != nil {
		return Tuple{}, err
	}
	t.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	return t, err
}

func (s *Store) ListTuples(projectID string) ([]Tuple, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, object, relation, user_key, home_project_id, home_cell_url, created_at
		 FROM tuples WHERE project_id = ? ORDER BY object, relation, user_key`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Tuple
	for rows.Next() {
		var t Tuple
		var created string
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Object, &t.Relation, &t.UserKey, &t.HomeProjectID, &t.HomeCellURL, &created); err != nil {
			return nil, err
		}
		t.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) CreateInterest(i Interest) error {
	key := NormalizeKey(i.PrincipalKey)
	if key == "" || i.HomeProjectID == "" || i.SubscriberCellURL == "" || i.SubscriberProjectID == "" || i.TupleID == "" {
		return ErrSubjectRequired
	}
	_, err := s.db.Exec(
		`INSERT INTO interests(id, principal_key, home_project_id, subscriber_cell_url, subscriber_project_id, tuple_id, object, relation, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		i.ID, key, i.HomeProjectID, NormalizeURL(i.SubscriberCellURL), i.SubscriberProjectID, i.TupleID,
		strings.TrimSpace(i.Object), strings.TrimSpace(i.Relation),
		i.CreatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrInterestExists
	}
	return err
}

func (s *Store) ListInterests() ([]Interest, error) {
	rows, err := s.db.Query(
		`SELECT id, principal_key, home_project_id, subscriber_cell_url, subscriber_project_id, tuple_id, object, relation, created_at
		 FROM interests ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Interest
	for rows.Next() {
		var i Interest
		var created string
		if err := rows.Scan(
			&i.ID, &i.PrincipalKey, &i.HomeProjectID, &i.SubscriberCellURL, &i.SubscriberProjectID,
			&i.TupleID, &i.Object, &i.Relation, &created,
		); err != nil {
			return nil, err
		}
		i.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (s *Store) ListInterestsForProject(homeProjectID string) ([]Interest, error) {
	rows, err := s.db.Query(
		`SELECT id, principal_key, home_project_id, subscriber_cell_url, subscriber_project_id, tuple_id, object, relation, created_at
		 FROM interests WHERE home_project_id = ? ORDER BY created_at DESC`,
		homeProjectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Interest
	for rows.Next() {
		var i Interest
		var created string
		if err := rows.Scan(
			&i.ID, &i.PrincipalKey, &i.HomeProjectID, &i.SubscriberCellURL, &i.SubscriberProjectID,
			&i.TupleID, &i.Object, &i.Relation, &created,
		); err != nil {
			return nil, err
		}
		i.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (s *Store) CountUsers(projectID string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE project_id = ?`, projectID).Scan(&n)
	return n, err
}

func (s *Store) CountTuples(projectID string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM tuples WHERE project_id = ?`, projectID).Scan(&n)
	return n, err
}

func (s *Store) HasUser(projectID, email string) (bool, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM users WHERE project_id = ? AND email = ?`,
		projectID, NormalizeKey(email),
	).Scan(&n)
	return n > 0, err
}
