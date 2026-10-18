package cell

import (
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

var (
	ErrUserNotFound      = errors.New("user_not_found")
	ErrInvalidToken      = errors.New("invalid_token")
	ErrTokenSignature    = errors.New("token_signature_invalid")
	ErrTokenExpired      = errors.New("token_expired")
	ErrTokenAudience     = errors.New("token_audience_mismatch")
	ErrPrincipalInactive = errors.New("principal_inactive")
	ErrEpochMismatch     = errors.New("epoch_mismatch")
	ErrGrantDenied       = errors.New("grant_denied")
	ErrNoSigningKey      = errors.New("no_signing_key")
)

const (
	SigningKeyID     = "cell-ed25519-1"
	TokenTTL         = 60 * time.Second
	JWKSCacheTTL     = 30 * time.Second
	DefaultUserEpoch = 1
)

type SigningKey struct {
	Kid        string
	PrivateKey ed25519.PrivateKey
	PublicKey  ed25519.PublicKey
}

func (s *Store) migrateAuth() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS signing_keys (
  kid TEXT PRIMARY KEY,
  private_key_b64 TEXT NOT NULL,
  public_key_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);`)
	if err != nil {
		return err
	}
	// Epoch column for future block/delete (P6); default 1 when absent.
	if err := s.ensureColumn("users", "epoch", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureColumn(table, column, decl string) error {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + decl)
	return err
}

func (s *Store) GetOrCreateSigningKey() (SigningKey, error) {
	key, err := s.getSigningKey(SigningKeyID)
	if err == nil {
		return key, nil
	}
	if !errors.Is(err, ErrNoSigningKey) {
		return SigningKey{}, err
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return SigningKey{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.Exec(
		`INSERT INTO signing_keys(kid, private_key_b64, public_key_b64, created_at) VALUES (?, ?, ?, ?)`,
		SigningKeyID,
		base64.RawURLEncoding.EncodeToString(priv),
		base64.RawURLEncoding.EncodeToString(pub),
		now,
	)
	if err != nil {
		// Race: another opener may have inserted; re-read.
		if key, rerr := s.getSigningKey(SigningKeyID); rerr == nil {
			return key, nil
		}
		return SigningKey{}, err
	}
	return SigningKey{Kid: SigningKeyID, PrivateKey: priv, PublicKey: pub}, nil
}

func (s *Store) getSigningKey(kid string) (SigningKey, error) {
	var privB64, pubB64 string
	err := s.db.QueryRow(
		`SELECT private_key_b64, public_key_b64 FROM signing_keys WHERE kid = ?`, kid,
	).Scan(&privB64, &pubB64)
	if errors.Is(err, sql.ErrNoRows) {
		return SigningKey{}, ErrNoSigningKey
	}
	if err != nil {
		return SigningKey{}, err
	}
	priv, err := base64.RawURLEncoding.DecodeString(privB64)
	if err != nil {
		return SigningKey{}, err
	}
	pub, err := base64.RawURLEncoding.DecodeString(pubB64)
	if err != nil {
		return SigningKey{}, err
	}
	if len(priv) != ed25519.PrivateKeySize || len(pub) != ed25519.PublicKeySize {
		return SigningKey{}, ErrNoSigningKey
	}
	return SigningKey{
		Kid:        kid,
		PrivateKey: ed25519.PrivateKey(priv),
		PublicKey:  ed25519.PublicKey(pub),
	}, nil
}

func (s *Store) GetUser(projectID, email string) (User, error) {
	var u User
	var created string
	var epoch sql.NullInt64
	err := s.db.QueryRow(
		`SELECT id, project_id, email, created_at, epoch FROM users WHERE project_id = ? AND email = ?`,
		projectID, NormalizeKey(email),
	).Scan(&u.ID, &u.ProjectID, &u.Email, &created, &epoch)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
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
	return u, nil
}

// FindGrant looks for a local tuple matching object/relation for this principal.
// Accepts either direct user_key match or Phase-3 subject home alignment.
func (s *Store) FindGrant(projectID, object, relation, userKey, homeProjectID, homeCellURL string) (Tuple, bool, error) {
	tuples, err := s.ListTuples(projectID)
	if err != nil {
		return Tuple{}, false, err
	}
	key := NormalizeKey(userKey)
	object = strings.TrimSpace(object)
	relation = strings.TrimSpace(relation)
	homeCellURL = NormalizeURL(homeCellURL)
	wantSubject := FormatSubject(key, homeProjectID, homeCellURL)
	for _, t := range tuples {
		if t.Object != object || t.Relation != relation {
			continue
		}
		if t.UserKey == key {
			// Direct subject match (same user key on this grant).
			if homeProjectID == "" || homeCellURL == "" {
				return t, true, nil
			}
			if t.HomeProjectID == homeProjectID && NormalizeURL(t.HomeCellURL) == homeCellURL {
				return t, true, nil
			}
			if t.Subject() == wantSubject {
				return t, true, nil
			}
		}
	}
	return Tuple{}, false, nil
}

func FormatSubject(userKey, homeProjectID, homeCellURL string) string {
	return "user:" + NormalizeKey(userKey) + "@" + homeProjectID + "@" + NormalizeURL(homeCellURL)
}
