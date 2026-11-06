package cell

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrAppExists          = errors.New("app_exists")
	ErrAppNotFound        = errors.New("app_not_found")
	ErrTupleExists        = errors.New("tuple_exists")
	ErrTupleNotFound      = errors.New("tuple_not_found")
	ErrInterestExists     = errors.New("interest_exists")
	ErrInvalidAppName     = errors.New("invalid_app_name")
	ErrInvalidRelation    = errors.New("invalid_relation")
	ErrInvalidObject      = errors.New("invalid_object")
	ErrSubjectRequired    = errors.New("subject_required")
	ErrPrincipalNotFound  = errors.New("principal_not_found")
	ErrInvalidSubjectKind = errors.New("invalid_subject_kind")
	ErrMaxDepthExceeded   = errors.New("max_depth_exceeded")
	ErrExpandCycle        = errors.New("expand_cycle")
	ErrAppHasActiveTuples = errors.New("app_has_active_tuples")
)

const (
	SubjectKindUser    = "user"
	SubjectKindGroup   = "group"
	DefaultFGAMaxDepth = 8
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
	SubjectKind   string // "user" | "group"
	UserKey       string // user email or group id (e.g. "A")
	HomeProjectID string
	HomeCellURL   string
	CreatedAt     time.Time
	TombstonedAt  *time.Time
}

func (t Tuple) IsTombstoned() bool {
	return t.TombstonedAt != nil
}

func (t Tuple) Kind() string {
	if t.SubjectKind == "" {
		return SubjectKindUser
	}
	return t.SubjectKind
}

func (t Tuple) Subject() string {
	kind := t.Kind()
	if t.HomeProjectID == "" && t.HomeCellURL == "" {
		return fmt.Sprintf("%s:%s", kind, t.UserKey)
	}
	return fmt.Sprintf("%s:%s@%s@%s", kind, t.UserKey, t.HomeProjectID, t.HomeCellURL)
}

func (t Tuple) IsGroupSubject() bool {
	return t.Kind() == SubjectKindGroup
}

func (t Tuple) IsUserSubject() bool {
	return t.Kind() == SubjectKindUser
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
	if err != nil {
		return err
	}
	if err := s.ensureColumn("tuples", "subject_kind", "TEXT NOT NULL DEFAULT 'user'"); err != nil {
		return err
	}
	if err := s.ensureColumn("tuples", "tombstoned_at", "TEXT"); err != nil {
		return err
	}
	return s.migrateTeams()
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
	a, err := s.GetApp(projectID, id)
	if err != nil {
		return err
	}
	obj := fmt.Sprintf("app:%s", a.Name)
	n, err := s.CountActiveTuplesReferencingObject(projectID, obj)
	if err != nil {
		return err
	}
	if n > 0 {
		return ErrAppHasActiveTuples
	}
	res, err := s.db.Exec(`DELETE FROM apps WHERE project_id = ? AND id = ?`, projectID, id)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrAppNotFound
	}
	return nil
}

func (s *Store) DeleteInterestByTupleID(tupleID string) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM interests WHERE tuple_id = ?`, strings.TrimSpace(tupleID))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func NormalizeSubjectKind(kind string) (string, error) {
	kind = strings.TrimSpace(strings.ToLower(kind))
	if kind == "" {
		return SubjectKindUser, nil
	}
	switch kind {
	case SubjectKindUser, SubjectKindGroup:
		return kind, nil
	default:
		return "", ErrInvalidSubjectKind
	}
}

func NormalizeSubjectKey(kind, key string) string {
	key = strings.TrimSpace(key)
	if kind == SubjectKindUser {
		return NormalizeKey(key)
	}
	// Group ids stay as-is (case-sensitive trim only).
	return key
}

func (s *Store) CreateTuple(t Tuple) error {
	obj := strings.TrimSpace(t.Object)
	rel := strings.TrimSpace(t.Relation)
	kind, err := NormalizeSubjectKind(t.SubjectKind)
	if err != nil {
		return err
	}
	key := NormalizeSubjectKey(kind, t.UserKey)
	if obj == "" {
		return ErrInvalidObject
	}
	if rel == "" {
		return ErrInvalidRelation
	}
	if key == "" {
		return ErrSubjectRequired
	}
	// User subjects always need a home (resolved via lookup). Group subjects need
	// home when they live on another project/cell; local groups may omit home.
	if kind == SubjectKindUser && (t.HomeProjectID == "" || t.HomeCellURL == "") {
		return ErrSubjectRequired
	}
	if kind == SubjectKindGroup && (t.HomeProjectID == "") != (t.HomeCellURL == "") {
		return ErrSubjectRequired
	}
	_, err = s.db.Exec(
		`INSERT INTO tuples(id, project_id, object, relation, subject_kind, user_key, home_project_id, home_cell_url, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.ProjectID, obj, rel, kind, key, t.HomeProjectID, NormalizeURL(t.HomeCellURL),
		t.CreatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrTupleExists
	}
	return err
}

const tupleSelectCols = `id, project_id, object, relation, subject_kind, user_key, home_project_id, home_cell_url, created_at, tombstoned_at`

func scanTuple(scanner interface {
	Scan(dest ...any) error
}) (Tuple, error) {
	var t Tuple
	var created string
	var kind sql.NullString
	var tombstoned sql.NullString
	err := scanner.Scan(
		&t.ID, &t.ProjectID, &t.Object, &t.Relation, &kind,
		&t.UserKey, &t.HomeProjectID, &t.HomeCellURL, &created, &tombstoned,
	)
	if err != nil {
		return Tuple{}, err
	}
	if kind.Valid && kind.String != "" {
		t.SubjectKind = kind.String
	} else {
		t.SubjectKind = SubjectKindUser
	}
	t.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return Tuple{}, err
	}
	if tombstoned.Valid && tombstoned.String != "" {
		ts, err := time.Parse(time.RFC3339Nano, tombstoned.String)
		if err != nil {
			return Tuple{}, err
		}
		t.TombstonedAt = &ts
	}
	return t, nil
}

func (s *Store) GetTuple(id string) (Tuple, error) {
	row := s.db.QueryRow(
		`SELECT `+tupleSelectCols+` FROM tuples WHERE id = ?`, id,
	)
	t, err := scanTuple(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Tuple{}, ErrTupleNotFound
	}
	return t, err
}

func (s *Store) ListTuples(projectID string) ([]Tuple, error) {
	rows, err := s.db.Query(
		`SELECT `+tupleSelectCols+` FROM tuples WHERE project_id = ? ORDER BY object, relation, user_key`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Tuple
	for rows.Next() {
		t, err := scanTuple(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListTuplesForRelation returns active (non-tombstoned) local tuples for object#relation.
func (s *Store) ListTuplesForRelation(projectID, object, relation string) ([]Tuple, error) {
	rows, err := s.db.Query(
		`SELECT `+tupleSelectCols+` FROM tuples
		 WHERE project_id = ? AND object = ? AND relation = ?
		   AND (tombstoned_at IS NULL OR tombstoned_at = '')
		 ORDER BY subject_kind, user_key`,
		projectID, strings.TrimSpace(object), strings.TrimSpace(relation),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Tuple
	for rows.Next() {
		t, err := scanTuple(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ReviveTombstonedTuple clears tombstoned_at on a matching row and refreshes home fields.
func (s *Store) ReviveTombstonedTuple(projectID, object, relation, kind, key, homeProjectID, homeCellURL string, at time.Time) (Tuple, bool, error) {
	row := s.db.QueryRow(
		`SELECT `+tupleSelectCols+` FROM tuples
		 WHERE project_id = ? AND object = ? AND relation = ? AND user_key = ?`,
		projectID, strings.TrimSpace(object), strings.TrimSpace(relation), NormalizeSubjectKey(kind, key),
	)
	t, err := scanTuple(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Tuple{}, false, nil
	}
	if err != nil {
		return Tuple{}, false, err
	}
	if !t.IsTombstoned() {
		return Tuple{}, false, nil
	}
	kindNorm, err := NormalizeSubjectKind(kind)
	if err != nil {
		return Tuple{}, false, err
	}
	_, err = s.db.Exec(
		`UPDATE tuples SET subject_kind = ?, home_project_id = ?, home_cell_url = ?, tombstoned_at = NULL, created_at = ?
		 WHERE id = ?`,
		kindNorm, homeProjectID, NormalizeURL(homeCellURL), at.UTC().Format(time.RFC3339Nano), t.ID,
	)
	if err != nil {
		return Tuple{}, false, err
	}
	t.SubjectKind = kindNorm
	t.HomeProjectID = homeProjectID
	t.HomeCellURL = NormalizeURL(homeCellURL)
	t.TombstonedAt = nil
	t.CreatedAt = at
	return t, true, nil
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
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM tuples WHERE project_id = ? AND (tombstoned_at IS NULL OR tombstoned_at = '')`,
		projectID,
	).Scan(&n)
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
