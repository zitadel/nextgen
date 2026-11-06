package cell

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrGroupExists      = errors.New("group_exists")
	ErrGroupNotFound    = errors.New("group_not_found")
	ErrInvalidGroupName = errors.New("invalid_group_name")
	ErrGroupHasTuples   = errors.New("group_has_active_tuples")
	ErrGroupSubjectMiss = errors.New("group_not_found_in_project")
)

type Group struct {
	ID        string
	ProjectID string
	Name      string
	CreatedAt time.Time
}

func (s *Store) migrateGroups() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);`)
	return err
}

func (s *Store) CreateGroup(g Group) error {
	name := strings.TrimSpace(g.Name)
	if name == "" {
		return ErrInvalidGroupName
	}
	_, err := s.db.Exec(
		`INSERT INTO groups(id, project_id, name, created_at) VALUES (?, ?, ?, ?)`,
		g.ID, g.ProjectID, name, g.CreatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrGroupExists
	}
	return err
}

func (s *Store) GetGroup(projectID, id string) (Group, error) {
	var g Group
	var created string
	err := s.db.QueryRow(
		`SELECT id, project_id, name, created_at FROM groups WHERE project_id = ? AND id = ?`,
		projectID, id,
	).Scan(&g.ID, &g.ProjectID, &g.Name, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Group{}, ErrGroupNotFound
	}
	if err != nil {
		return Group{}, err
	}
	g.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	return g, err
}

func (s *Store) GetGroupByName(projectID, name string) (Group, error) {
	var g Group
	var created string
	err := s.db.QueryRow(
		`SELECT id, project_id, name, created_at FROM groups WHERE project_id = ? AND name = ?`,
		projectID, strings.TrimSpace(name),
	).Scan(&g.ID, &g.ProjectID, &g.Name, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Group{}, ErrGroupNotFound
	}
	if err != nil {
		return Group{}, err
	}
	g.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	return g, err
}

func (s *Store) ListGroups(projectID string) ([]Group, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, name, created_at FROM groups WHERE project_id = ? ORDER BY name`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Group
	for rows.Next() {
		var g Group
		var created string
		if err := rows.Scan(&g.ID, &g.ProjectID, &g.Name, &created); err != nil {
			return nil, err
		}
		g.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// CountActiveTuplesReferencingObject counts non-tombstoned tuples with the given object.
func (s *Store) CountActiveTuplesReferencingObject(projectID, object string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM tuples
		 WHERE project_id = ? AND object = ?
		   AND (tombstoned_at IS NULL OR tombstoned_at = '')`,
		projectID, strings.TrimSpace(object),
	).Scan(&n)
	return n, err
}

// CountActiveTuplesWithGroupSubject counts non-tombstoned tuples whose subject is group:name.
func (s *Store) CountActiveTuplesWithGroupSubject(projectID, groupName string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM tuples
		 WHERE project_id = ? AND subject_kind = ? AND user_key = ?
		   AND (tombstoned_at IS NULL OR tombstoned_at = '')`,
		projectID, SubjectKindGroup, strings.TrimSpace(groupName),
	).Scan(&n)
	return n, err
}

// DeleteGroup removes a group when no active tuples reference it as object or group subject.
func (s *Store) DeleteGroup(projectID, id string) error {
	g, err := s.GetGroup(projectID, id)
	if err != nil {
		return err
	}
	obj := fmt.Sprintf("group:%s", g.Name)
	nObj, err := s.CountActiveTuplesReferencingObject(projectID, obj)
	if err != nil {
		return err
	}
	nSub, err := s.CountActiveTuplesWithGroupSubject(projectID, g.Name)
	if err != nil {
		return err
	}
	if nObj > 0 || nSub > 0 {
		return ErrGroupHasTuples
	}
	res, err := s.db.Exec(`DELETE FROM groups WHERE project_id = ? AND id = ?`, projectID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrGroupNotFound
	}
	return nil
}
