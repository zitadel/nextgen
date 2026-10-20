package cell

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrTeamExists        = errors.New("team_exists")
	ErrTeamNotFound      = errors.New("team_not_found")
	ErrInvalidTeamName   = errors.New("invalid_team_name")
	ErrParentTeamMiss    = errors.New("parent_team_not_found")
	ErrParentTeamProject = errors.New("parent_team_wrong_project")
	ErrTeamHasUsers      = errors.New("team_has_users")
	ErrTeamHasChildren   = errors.New("team_has_children")
)

type Team struct {
	ID           string
	ProjectID    string
	Name         string
	ParentTeamID string
	CreatedAt    time.Time
}

func (s *Store) migrateTeams() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_team_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);`)
	return err
}

func (s *Store) CreateTeam(t Team) error {
	name := strings.TrimSpace(t.Name)
	if name == "" {
		return ErrInvalidTeamName
	}
	parent := strings.TrimSpace(t.ParentTeamID)
	if parent != "" {
		pt, err := s.GetTeam(t.ProjectID, parent)
		if err != nil {
			if errors.Is(err, ErrTeamNotFound) {
				return ErrParentTeamMiss
			}
			return err
		}
		if pt.ProjectID != t.ProjectID {
			return ErrParentTeamProject
		}
	}
	_, err := s.db.Exec(
		`INSERT INTO teams(id, project_id, name, parent_team_id, created_at) VALUES (?, ?, ?, ?, ?)`,
		t.ID, t.ProjectID, name, parent, t.CreatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrTeamExists
	}
	return err
}

func (s *Store) GetTeam(projectID, id string) (Team, error) {
	var t Team
	var created string
	err := s.db.QueryRow(
		`SELECT id, project_id, name, parent_team_id, created_at FROM teams WHERE project_id = ? AND id = ?`,
		projectID, id,
	).Scan(&t.ID, &t.ProjectID, &t.Name, &t.ParentTeamID, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Team{}, ErrTeamNotFound
	}
	if err != nil {
		return Team{}, err
	}
	t.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	return t, err
}

func (s *Store) ListTeams(projectID string) ([]Team, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, name, parent_team_id, created_at FROM teams WHERE project_id = ? ORDER BY name`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Team
	for rows.Next() {
		var t Team
		var created string
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Name, &t.ParentTeamID, &created); err != nil {
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

func (s *Store) CountUsersOnTeam(projectID, teamID string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM users
		 WHERE project_id = ? AND lifecycle_owner_team_id = ?
		   AND (deleted_at IS NULL OR deleted_at = '')`,
		projectID, strings.TrimSpace(teamID),
	).Scan(&n)
	return n, err
}

func (s *Store) CountChildTeams(projectID, teamID string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM teams WHERE project_id = ? AND parent_team_id = ?`,
		projectID, strings.TrimSpace(teamID),
	).Scan(&n)
	return n, err
}

// DeleteTeam removes a team when no users reference it and it has no child teams.
func (s *Store) DeleteTeam(projectID, id string) error {
	if _, err := s.GetTeam(projectID, id); err != nil {
		return err
	}
	nUsers, err := s.CountUsersOnTeam(projectID, id)
	if err != nil {
		return err
	}
	if nUsers > 0 {
		return ErrTeamHasUsers
	}
	nChildren, err := s.CountChildTeams(projectID, id)
	if err != nil {
		return err
	}
	if nChildren > 0 {
		return ErrTeamHasChildren
	}
	res, err := s.db.Exec(`DELETE FROM teams WHERE project_id = ? AND id = ?`, projectID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrTeamNotFound
	}
	return nil
}
