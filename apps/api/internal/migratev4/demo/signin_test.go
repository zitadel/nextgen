//go:build migratev4_demo

// The demo check: after `nextgen migrate-v4 run` against the database
// start-v4.sh and seed-v4.mjs --supported built, every seeded user must have
// migrated and must sign in with their original v4 password.
//
//	MIGRATE_V4_DEMO_DSN=postgres://postgres@127.0.0.1:55432/v4demo_supported?sslmode=disable \
//	MIGRATE_V4_DEMO_SUMMARY=$V4_DATA_DIR/seed-summary.json \
//	go test -tags migratev4_demo -count=1 -v ./internal/migratev4/demo/
package demo_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/postgres"
)

type summary struct {
	Profile string `json:"profile"`
	V4      struct {
		InstanceID string `json:"instanceId"`
	} `json:"v4"`
	Users []struct {
		Key       string `json:"key"`
		LoginName string `json:"loginName"`
		ID        string `json:"id"`
		Email     string `json:"email"`
		State     string `json:"expectedState"`
		Password  *struct {
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
	require.Equal(t, "supported", seed.Profile, "use seed-v4.mjs --supported in a separate database; the full fixture must be blocked")
	require.NotEmpty(t, seed.Users)

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
	mappedID := func(kind, id string) string {
		var targetID string
		require.NoError(t, conn.QueryRow(ctx, `SELECT target_id FROM zitadel_migrate_v4.id_map
WHERE source_kind=$1 AND source_id=$2 AND instance_id=$3 AND status='applied'`, kind, id, seed.V4.InstanceID).Scan(&targetID), "missing applied %s mapping for %s", kind, id)
		return targetID
	}
	projectID := mappedID("project", seed.V4.InstanceID)
	schema, err := db.Statements().GetJSONSchemaByID(ctx, projectID, mappedID("schema", "human-user"))
	require.NoError(t, err)
	var designation struct {
		Identifier string `json:"x-identifier"`
	}
	require.NoError(t, json.Unmarshal(schema.Schema, &designation))
	require.Contains(t, []string{"email", "login_name"}, designation.Identifier)

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
	authn := service.NewAuthAttemptService(db, service.SessionStatementsResolver{Pool: db}, service.UserStatementsLookup{Pool: db}, service.NewProjectHasherResolver(db, hashers), hashers.Default())

	signIn := func(identifier, password string) (string, error) {
		attempt, err := authn.Create(ctx, service.CreateAuthAttemptInput{ProjectID: projectID})
		if err != nil {
			return "create", err
		}
		for _, step := range []struct {
			challenge service.Challenge
			check     domain.AuthCheckType
			proof     service.Proof
		}{
			{service.UserChallenge{}, domain.AuthCheckTypeUser, service.UserProof{LoginName: identifier}},
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
		require.Equal(t, "active", u.State)
		require.NotNil(t, u.Password)
		require.NotEmpty(t, u.Password.Plaintext)
		userID := mappedID("user", u.ID)
		mappedID("password", u.ID)
		t.Run(u.Key, func(t *testing.T) {
			user, err := db.Statements().GetUser(ctx, database.And(
				database.Equal(database.Col(domain.UserFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserFieldID), userID)), service.UserQueryOptions{})
			require.NoError(t, err)
			require.Equal(t, domain.UserStatusActive, user.Metadata.Status)
			attributes := map[string]any{}
			for _, attribute := range user.Attributes {
				attributes[string(attribute.Key)] = attribute.Value
			}
			require.Equal(t, u.LoginName, attributes["login_name"], "compare with v4's API, independently of the migrator's reducer")
			identifier := u.Email
			if designation.Identifier == "login_name" {
				identifier = u.LoginName
			}
			stage, err := signIn(identifier, u.Password.Plaintext)
			require.NoError(t, err, "sign-in failed at %s", stage)
			t.Logf("signed in with the v4 password (%s%s)", u.Password.StoredAs, u.Password.Format)
		})
	}
}
