// Package v4test builds the parts of a Zitadel v4 database the migrator reads,
// for tests: the eventstore table, the encryption keys, and a pusher that
// writes events the way v4.19 does.
package v4test

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
)

// MasterKey is the 32-byte master key test databases are encrypted with.
const MasterKey = "MasterkeyNeedsToHave32Characters"

// schema is the subset of v4.19.5's setup the migrator reads.
const schema = `
CREATE SCHEMA IF NOT EXISTS eventstore;
CREATE SCHEMA IF NOT EXISTS system;
CREATE TABLE IF NOT EXISTS eventstore.events2 (
	instance_id TEXT NOT NULL,
	aggregate_type TEXT NOT NULL,
	aggregate_id TEXT NOT NULL,
	event_type TEXT NOT NULL,
	"sequence" BIGINT NOT NULL,
	revision SMALLINT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL,
	payload JSONB,
	creator TEXT NOT NULL,
	"owner" TEXT NOT NULL,
	"position" DECIMAL NOT NULL,
	in_tx_order INTEGER NOT NULL,
	PRIMARY KEY (instance_id, aggregate_type, aggregate_id, "sequence")
);
CREATE INDEX IF NOT EXISTS es_projection ON eventstore.events2 (instance_id, aggregate_type, event_type, "position");
CREATE TABLE IF NOT EXISTS system.encryption_keys (id TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (id));`

// CreateSchema creates eventstore.events2 and system.encryption_keys.
func CreateSchema(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, schema)
	return err
}

// MarkSetupStep records a setup step as done, as v4's migration runner does.
func MarkSetupStep(ctx context.Context, pool *pgxpool.Pool, name string) error {
	return push(ctx, pool, "", "system", "SYSTEM", "SYSTEM", "system.migration.done", map[string]string{"name": name})
}

// StoreKey wraps key with MasterKey and stores it under id, as v4's key
// storage does.
func StoreKey(ctx context.Context, pool *pgxpool.Pool, id string, key []byte) error {
	wrapped, err := encryptAES(key, []byte(MasterKey))
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `INSERT INTO system.encryption_keys (id, key) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
		id, base64.URLEncoding.EncodeToString(wrapped))
	return err
}

// Encrypt encrypts plaintext under key, as v4's AESCrypto does.
func Encrypt(keyID string, key []byte, plaintext string) (*v4.CryptoValue, error) {
	crypted, err := encryptAES([]byte(plaintext), key)
	if err != nil {
		return nil, err
	}
	return &v4.CryptoValue{CryptoType: 0, Algorithm: "aes", KeyID: keyID, Crypted: crypted}, nil
}

// Instance pushes the events of one v4 instance.
type Instance struct {
	pool *pgxpool.Pool
	ID   string
}

// NewInstance returns a pusher for the instance.
func NewInstance(pool *pgxpool.Pool, id string) *Instance {
	return &Instance{pool: pool, ID: id}
}

// Push writes one event as v4 does: under the shared instance lock, with the
// aggregate's next sequence and a position stamped at insert time.
func (i *Instance) Push(ctx context.Context, aggregateType, aggregateID, owner, eventType string, payload any) error {
	return push(ctx, i.pool, i.ID, aggregateType, aggregateID, owner, eventType, payload)
}

// Delete removes the instance's events, for test cleanup.
func (i *Instance) Delete(ctx context.Context) error {
	_, err := i.pool.Exec(ctx, `DELETE FROM eventstore.events2 WHERE instance_id = $1`, i.ID)
	return err
}

func push(ctx context.Context, pool *pgxpool.Pool, instanceID, aggregateType, aggregateID, owner, eventType string, payload any) error {
	var raw []byte
	if payload != nil {
		var err error
		if raw, err = json.Marshal(payload); err != nil {
			return err
		}
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared('eventstore.events2'::regclass::oid::integer, hashtext($1))`, instanceID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
INSERT INTO eventstore.events2 (instance_id, aggregate_type, aggregate_id, event_type, sequence, revision, created_at, payload, creator, owner, position, in_tx_order)
SELECT $1, $2, $3, $4, COALESCE(max(sequence), 0) + 1, 1, statement_timestamp(), $5, 'v4test', $6, EXTRACT(EPOCH FROM clock_timestamp()), 1
FROM eventstore.events2 WHERE instance_id = $1 AND aggregate_type = $2 AND aggregate_id = $3`,
			instanceID, aggregateType, aggregateID, eventType, raw, owner)
		if err != nil {
			return fmt.Errorf("push %s: %w", eventType, err)
		}
		return nil
	})
}

// encryptAES is v4's crypto.EncryptAES: a random IV, then AES-CFB.
func encryptAES(plain, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	out := make([]byte, aes.BlockSize+len(plain))
	if _, err := rand.Read(out[:aes.BlockSize]); err != nil {
		return nil, err
	}
	cipher.NewCFBEncrypter(block, out[:aes.BlockSize]).XORKeyStream(out[aes.BlockSize:], plain) //nolint:staticcheck // v4's format
	return out, nil
}
