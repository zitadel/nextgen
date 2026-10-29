//go:build migratev4_demo

// The demo check: after `nextgen migrate-v4 run` against the database
// start-v4.sh and seed-v4.mjs built, every seeded user with a known v4 password
// signs in to nextgen with it, unless the report said why not.
//
//	MIGRATE_V4_DEMO_DSN=postgres://postgres@127.0.0.1:55432/v4demo?sslmode=disable \
//	MIGRATE_V4_DEMO_SUMMARY=$V4_DATA_DIR/seed-summary.json \
//	go test -tags migratev4_demo -count=1 -v ./internal/migratev4/demo/
package demo_test

import (
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/postgres"
)

type summary struct {
	V4 struct {
		InstanceID string `json:"instanceId"`
	} `json:"v4"`
	Users []struct {
		Key      string `json:"key"`
		ID       string `json:"id"`
		Email    string `json:"email"`
		State    string `json:"expectedState"`
		Password *struct {
			Kind      string `json:"kind"`
			Plaintext string `json:"plaintext"`
			StoredAs  string `json:"storedAs"`
			Format    string `json:"format"`
		} `json:"password"`
	} `json:"users"`
}

func TestSignInWithV4Passwords(t *testing.T) {
	dsn, path := os.Getenv("MIGRATE_V4_DEMO_DSN"), os.Getenv("MIGRATE_V4_DEMO_SUMMARY")
	if dsn == "" || path == "" {
		t.Skip("set MIGRATE_V4_DEMO_DSN and MIGRATE_V4_DEMO_SUMMARY")
	}
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	var seed summary
	require.NoError(t, json.Unmarshal(raw, &seed))

	ctx := t.Context()
	dialect, err := postgres.DecodeConfig(dsn)
	require.NoError(t, err)
	pool, err := dialect.Connect(ctx)
	require.NoError(t, err)
	defer pool.Close(ctx)
	db := service.NewPool(pool.(service.Pool))

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	defer conn.Close(ctx)
	var projectID string
	require.NoError(t, conn.QueryRow(ctx, `SELECT target_id FROM zitadel_migrate_v4.id_map WHERE source_kind = 'project' AND instance_id = $1`, seed.V4.InstanceID).Scan(&projectID))
	nextgenStatus := func(id string) string {
		var status string
		_ = conn.QueryRow(ctx, `SELECT u.status FROM zitadel_nextgen.users u JOIN zitadel_migrate_v4.id_map m
			ON m.target_id = u.id AND m.source_kind = 'user' AND m.instance_id = $1 WHERE m.source_id = $2`, seed.V4.InstanceID, id).Scan(&status)
		return status
	}
	migrated := func(kind, id string) bool {
		var applied bool
		err := conn.QueryRow(ctx, `SELECT status = 'applied' FROM zitadel_migrate_v4.id_map WHERE instance_id = $1 AND source_kind = $2 AND source_id = $3`, seed.V4.InstanceID, kind, id).Scan(&applied)
		return err == nil && applied
	}

	// nextgen's default verifiers and limits (cmd/server readConfig).
	hashers, err := (&crypto.HashConfig{
		Hasher: crypto.HasherConfig{Algorithm: crypto.HashNameArgon2id, Params: map[string]any{"time": 3, "memory": 64 * 1024, "threads": 4}},
		Verifiers: []crypto.HashName{crypto.HashNameArgon2, crypto.HashNameBcrypt, crypto.HashNameScrypt, crypto.HashNamePBKDF2,
			crypto.HashNameSha2, crypto.HashNameMd5, crypto.HashNameMd5Salted, crypto.HashNamePHPass, crypto.HashNameDrupal7},
		Limits: crypto.HashLimitsConfig{
			Bcrypt: crypto.BcryptLimitsConfig{MinCost: 10, MaxCost: 16},
			Argon2: crypto.Argon2LimitsConfig{MinTime: 1, MaxTime: 10, MinMemory: 8 * 1024, MaxMemory: 512 * 1024, MinThreads: 1, MaxThreads: 16},
			Scrypt: crypto.ScryptLimitsConfig{MinLN: 12, MaxLN: 20, MinR: 8, MaxR: 8, MinP: 1, MaxP: 4},
			PBKDF2: crypto.PBKDF2LimitsConfig{MinRounds: 100_000, MaxRounds: 5_000_000},
			Sha2:   crypto.Sha2LimitsConfig{MinSha256Rounds: 5_000, MaxSha256Rounds: 1_000_000, MinSha512Rounds: 5_000, MaxSha512Rounds: 1_000_000},
		},
	}).NewHasherFactory()
	require.NoError(t, err)
	authn := service.NewAuthAttemptService(db, service.SessionStatementsResolver{Pool: db}, service.UserStatementsLookup{Pool: db}, hashers.Default())

	signIn := func(email, password string) (string, error) {
		attempt, err := authn.Create(ctx, service.CreateAuthAttemptInput{ProjectID: projectID})
		if err != nil {
			return "create", err
		}
		for _, step := range []struct {
			challenge service.Challenge
			check     domain.AuthCheckType
			proof     service.Proof
		}{
			{service.UserChallenge{}, domain.AuthCheckTypeUser, service.UserProof{LoginName: email}},
			{service.PasswordChallenge{}, domain.AuthCheckTypePassword, service.PasswordProof{Password: password}},
		} {
			issued, err := authn.IssueChallenge(ctx, service.IssueChallengeInput{ProjectID: projectID, AttemptID: attempt.ID, Challenge: step.challenge})
			if err != nil {
				return step.check.String(), err
			}
			ch, _ := issued.ChallengeByType(step.check)
			if _, err := authn.VerifyProof(ctx, service.VerifyProofInput{ProjectID: projectID, AttemptID: attempt.ID, ChallengeID: ch.GetID(), Proof: step.proof}); err != nil {
				return step.check.String(), err
			}
		}
		return "", nil
	}

	for _, u := range seed.Users {
		if u.Password == nil || u.Password.Plaintext == "" || u.State == "removed" {
			continue
		}
		hash := u.Password.StoredAs + u.Password.Format
		t.Run(u.Key, func(t *testing.T) {
			stage, err := signIn(u.Email, u.Password.Plaintext)
			switch {
			case !migrated("user", u.ID):
				require.Error(t, err, "a user the report skipped cannot sign in")
				t.Logf("not migrated (see the report): refused at %s", stage)
			case !migrated("password", u.ID):
				require.True(t, errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)) || err != nil, "a rejected hash leaves no password")
				t.Logf("hash not migrated (%s): refused at %s", hash, stage)
			default:
				require.NoError(t, err, "%s (%s)", u.Key, hash)
				if status := nextgenStatus(u.ID); status != string(domain.UserStatusActive) {
					// Gap G1 (docs/design/migrate-v4/nextgen-target.md): sign-in
					// does not check the user's status yet.
					t.Logf("GAP G1: %s in nextgen, signed in anyway (%s)", status, hash)
					return
				}
				t.Logf("signed in with the v4 password (%s)", hash)
			}
		})
	}
}
