package cell

import (
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"
)

var (
	ErrUserBlocked  = errors.New("user_blocked")
	ErrUserDeleted  = errors.New("user_deleted")
	ErrAlreadyGone  = errors.New("user_already_deleted")
	ErrEventUnknown = errors.New("unknown_lifecycle_event")
)

const (
	LookupStateTombstone = "tombstone"
	EventUserBlocked     = "user.blocked"
	EventUserDeleted     = "user.deleted"
	DenylistTTL          = TokenTTL // align with token TTL for demo stale-allow window
)

// Denylist is an in-memory cache of blocked principals on a subscriber cell.
type Denylist struct {
	mu   sync.Mutex
	ents map[string]time.Time // principal_key → expires_at
}

func NewDenylist() *Denylist {
	return &Denylist{ents: map[string]time.Time{}}
}

func denylistKey(projectID, principal string) string {
	return strings.TrimSpace(projectID) + "|" + NormalizeKey(principal)
}

func (d *Denylist) Put(projectID, principal string, until time.Time) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.ents[denylistKey(projectID, principal)] = until
}

func (d *Denylist) IsBlocked(projectID, principal string, now time.Time) bool {
	if d == nil {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	key := denylistKey(projectID, principal)
	exp, ok := d.ents[key]
	if !ok {
		return false
	}
	if !exp.After(now) {
		delete(d.ents, key)
		return false
	}
	return true
}

func (d *Denylist) Clear(projectID, principal string) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.ents, denylistKey(projectID, principal))
}

func (s *Store) migrateLifecycle() error {
	if err := s.ensureColumn("users", "blocked", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.ensureColumn("users", "deleted_at", "TEXT"); err != nil {
		return err
	}
	// Epoch already added in migrateAuth; ensure again for clean trees.
	return s.ensureColumn("users", "epoch", "INTEGER NOT NULL DEFAULT 1")
}

func scanUser(scanner interface {
	Scan(dest ...any) error
}) (User, error) {
	var u User
	var created string
	var epoch sql.NullInt64
	var blocked sql.NullInt64
	var deletedAt sql.NullString
	err := scanner.Scan(&u.ID, &u.ProjectID, &u.Email, &created, &epoch, &blocked, &deletedAt)
	if err != nil {
		return User{}, err
	}
	u.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return User{}, err
	}
	if epoch.Valid {
		u.Epoch = int(epoch.Int64)
	} else {
		u.Epoch = DefaultUserEpoch
	}
	u.Blocked = blocked.Valid && blocked.Int64 != 0
	if deletedAt.Valid && deletedAt.String != "" {
		t, err := time.Parse(time.RFC3339Nano, deletedAt.String)
		if err != nil {
			return User{}, err
		}
		u.DeletedAt = &t
	}
	return u, nil
}

const userSelectCols = `id, project_id, email, created_at, epoch, blocked, deleted_at`

// GetUser returns the user row including lifecycle fields.
func (s *Store) GetUser(projectID, email string) (User, error) {
	row := s.db.QueryRow(
		`SELECT `+userSelectCols+` FROM users WHERE project_id = ? AND email = ?`,
		projectID, NormalizeKey(email),
	)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	return u, err
}

func (s *Store) ListUsers(projectID string) ([]User, error) {
	rows, err := s.db.Query(
		`SELECT `+userSelectCols+` FROM users WHERE project_id = ? ORDER BY email`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// BlockUser sets blocked=true and increments epoch. Idempotent on already-blocked
// (still bumps epoch so online tokens with the old epoch fail).
func (s *Store) BlockUser(projectID, email string) (User, error) {
	u, err := s.GetUser(projectID, email)
	if err != nil {
		return User{}, err
	}
	if u.DeletedAt != nil {
		return User{}, ErrUserDeleted
	}
	epoch := u.Epoch
	if epoch <= 0 {
		epoch = DefaultUserEpoch
	}
	epoch++
	_, err = s.db.Exec(
		`UPDATE users SET blocked = 1, epoch = ? WHERE project_id = ? AND email = ?`,
		epoch, projectID, NormalizeKey(email),
	)
	if err != nil {
		return User{}, err
	}
	u.Blocked = true
	u.Epoch = epoch
	return u, nil
}

// DeleteUser marks the user tombstoned (deleted_at set, blocked=true, epoch++).
func (s *Store) DeleteUser(projectID, email string, at time.Time) (User, error) {
	u, err := s.GetUser(projectID, email)
	if err != nil {
		return User{}, err
	}
	if u.DeletedAt != nil {
		return User{}, ErrAlreadyGone
	}
	epoch := u.Epoch
	if epoch <= 0 {
		epoch = DefaultUserEpoch
	}
	epoch++
	atStr := at.UTC().Format(time.RFC3339Nano)
	_, err = s.db.Exec(
		`UPDATE users SET blocked = 1, epoch = ?, deleted_at = ? WHERE project_id = ? AND email = ?`,
		epoch, atStr, projectID, NormalizeKey(email),
	)
	if err != nil {
		return User{}, err
	}
	u.Blocked = true
	u.Epoch = epoch
	u.DeletedAt = &at
	return u, nil
}

func (s *Store) ListInterestsForPrincipal(homeProjectID, principalKey string) ([]Interest, error) {
	rows, err := s.db.Query(
		`SELECT id, principal_key, home_project_id, subscriber_cell_url, subscriber_project_id, tuple_id, object, relation, created_at
		 FROM interests WHERE home_project_id = ? AND principal_key = ? ORDER BY created_at DESC`,
		homeProjectID, NormalizeKey(principalKey),
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

func (s *Store) DeleteInterestsForPrincipal(homeProjectID, principalKey string) (int64, error) {
	res, err := s.db.Exec(
		`DELETE FROM interests WHERE home_project_id = ? AND principal_key = ?`,
		homeProjectID, NormalizeKey(principalKey),
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DeleteTuplesForPrincipal removes user-subject tuples for this principal on a project.
func (s *Store) DeleteTuplesForPrincipal(projectID, principalKey string) (int64, error) {
	res, err := s.db.Exec(
		`DELETE FROM tuples WHERE project_id = ? AND subject_kind = ? AND user_key = ?`,
		projectID, SubjectKindUser, NormalizeKey(principalKey),
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DeleteTupleByID removes one tuple by id (subscriber cleans a known grant).
func (s *Store) DeleteTupleByID(id string) error {
	res, err := s.db.Exec(`DELETE FROM tuples WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrTupleNotFound
	}
	return nil
}

// DeleteLocalUserTuples removes every user-subject tuple for principal across all
// projects on this cell (home-side group memberships + any local grants).
func (s *Store) DeleteLocalUserTuples(principalKey string) (int64, error) {
	res, err := s.db.Exec(
		`DELETE FROM tuples WHERE subject_kind = ? AND user_key = ?`,
		SubjectKindUser, NormalizeKey(principalKey),
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *Store) UpsertLookupTombstone(key, homeProjectID, homeCellURL string, at time.Time) error {
	key = NormalizeKey(key)
	if key == "" {
		return ErrLookupKeyRequired
	}
	existing, err := s.GetLookup(key)
	if err == nil {
		// Only the same home may tombstone; otherwise leave conflict rows alone.
		if existing.HomeProjectID != "" && existing.HomeProjectID != homeProjectID {
			return ErrLookupConflict
		}
		_, err = s.db.Exec(
			`UPDATE lookup_entries SET home_project_id = ?, home_cell_url = ?, state = ?, updated_at = ? WHERE key = ?`,
			homeProjectID, NormalizeURL(homeCellURL), LookupStateTombstone, at.UTC().Format(time.RFC3339Nano), key,
		)
		return err
	}
	if !errors.Is(err, ErrLookupNotFound) {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO lookup_entries(key, home_project_id, home_cell_url, state, updated_at) VALUES (?, ?, ?, ?, ?)`,
		key, homeProjectID, NormalizeURL(homeCellURL), LookupStateTombstone, at.UTC().Format(time.RFC3339Nano),
	)
	return err
}

func (s *Store) DeleteLookup(key string) error {
	_, err := s.db.Exec(`DELETE FROM lookup_entries WHERE key = ?`, NormalizeKey(key))
	return err
}

func (u User) IsActive() bool {
	return u.DeletedAt == nil && !u.Blocked
}
