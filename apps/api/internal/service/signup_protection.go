package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	mrand "math/rand/v2"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto/pow"
	"github.com/zitadel/nextgen/internal/domain"
)

// SignupProtection is deliberately limited to password signup. A proof buys
// one create_user attempt in its flow, not an authentication factor.
type SignupProtection interface {
	Challenge(context.Context, *domain.FlowState) (*pow.PublicChallenge, error)
	Consume(context.Context, *domain.FlowState, string) error
}

const (
	signupIssuanceLimit     = 10
	signupVerificationLimit = 20
	signupRefreshBefore     = time.Minute
	// One issuance in this many sweeps the project's expired rows, so
	// concurrent signups in one project rarely run the same delete.
	signupSweepOneIn = 16
	// A sweep deletes at most this many rows of each table, so a backlog left by
	// a burst drains over later sweeps instead of failing one oversized delete.
	signupSweepLimit = 1000
)

type signupProtection struct {
	db    StatementPool
	keys  KeyService
	now   func() time.Time
	sweep func() bool
}

func NewSignupProtection(db StatementPool, keys KeyService) SignupProtection {
	return &signupProtection{db: db, keys: keys, now: time.Now,
		sweep: func() bool { return mrand.IntN(signupSweepOneIn) == 0 }}
}

// The per-challenge solution MAC key never leaves encrypted storage. The
// existing project secret key wraps them; rotation uses the JWE's key ID.
type signupPayload struct {
	Body        []byte
	SolutionKey [32]byte
}

func signupBinding(state *domain.FlowState, id string, expires int64) pow.Binding {
	return pow.Binding{ProfileID: pow.DefaultProfile().ID(), ProjectID: state.ProjectID,
		Operation: "create_user", OperationInstanceID: state.ID, ChallengeID: id, ExpiresAt: expires}
}

// lockSignupLimits makes sure the flow has a limits row and locks it. The
// insert leaves an existing row alone and takes no lock on it, so a sweep can
// delete an hour-old row before the lock reads it; the row is then started
// again, in this transaction, where no sweep sees it.
func lockSignupLimits(ctx context.Context, st AllStatements, state *domain.FlowState) (*domain.SignupLimits, error) {
	for range 2 {
		if err := st.InsertSignupLimits(ctx, &domain.SignupLimits{ProjectID: state.ProjectID, FlowID: state.ID}); err != nil {
			return nil, err
		}
		limits, err := st.LockSignupLimits(ctx, state.ProjectID, state.ID)
		if err != nil || limits != nil {
			return limits, err
		}
	}
	return nil, domain.ErrInternal(errors.New("signup limits row is missing after it was inserted"))
}

// Limits belong to the server-issued flow, never to the entire project. New
// flows still need ingress rate limits; forwarded IP headers are not trusted.
func (s *signupProtection) charge(ctx context.Context, state *domain.FlowState, issue bool) error {
	return s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		st := tx.Statements()
		limits, err := lockSignupLimits(ctx, st, state)
		if err != nil {
			return err
		}
		now := s.now().Unix()
		if now >= limits.WindowStart+60 {
			limits.WindowStart = now
			limits.Issued = 0
			limits.Verified = 0
		}
		if issue {
			if limits.Issued >= signupIssuanceLimit {
				return domain.ErrFlowRateLimited()
			}
			limits.Issued++
		} else {
			if limits.Verified >= signupVerificationLimit {
				return domain.ErrFlowRateLimited()
			}
			limits.Verified++
		}
		return st.UpdateSignupLimits(ctx, limits)
	})
}

func signupPublic(record *domain.SignupChallengeRecord) (*pow.PublicChallenge, error) {
	var public pow.PublicChallenge
	if err := json.Unmarshal([]byte(record.Public), &public); err != nil {
		return nil, err
	}
	return &public, nil
}

func (s *signupProtection) open(ctx context.Context, record *domain.SignupChallengeRecord) (*signupPayload, error) {
	header, err := domain.DecodeStoredKeyJWEHeader(record.Payload)
	if err != nil {
		return nil, err
	}
	crypter, err := s.keys.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
	if err != nil {
		return nil, err
	}
	raw, err := crypter.Decrypt(record.Payload)
	if err != nil {
		return nil, err
	}
	var payload signupPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func (s *signupProtection) Challenge(ctx context.Context, state *domain.FlowState) (*pow.PublicChallenge, error) {
	if state == nil || state.ID == "" || state.ProjectID == "" {
		return nil, domain.ErrFlowIntegrity()
	}
	now := s.now()
	record, err := s.db.Statements().GetSignupChallenge(ctx, state.ProjectID, state.ID)
	if err != nil {
		return nil, err
	}
	if record != nil && record.ExpiresAt > now.Add(signupRefreshBefore).Unix() {
		return signupPublic(record)
	}
	if err := s.charge(ctx, state, true); err != nil {
		return nil, err
	}
	// Refused requests do no cleanup. Sweep via expiry indexes after releasing
	// the budget lock, so cleanup cannot invert two flows' lock order. Creation
	// upserts the flow's own row, so a skipped or failed sweep only leaves
	// expired rows for a later one.
	if s.sweep() {
		if err := s.db.Statements().DeleteExpiredSignupProtection(ctx, state.ProjectID, now.Unix(), signupSweepLimit); err != nil {
			getLoggingContext(ctx, "signup_protection").WarnContext(ctx, "sweeping expired signup challenges failed",
				slog.String("project_id", state.ProjectID),
				slog.Any("error", err),
			)
		}
	}
	id, err := s.db.Statements().NewManagedID(string(domain.PrefixChallenge))
	if err != nil {
		return nil, err
	}
	keys := pow.Keys{}
	if _, err := rand.Read(keys.Solution[:]); err != nil {
		return nil, err
	}
	challenge, err := pow.Issue(signupBinding(state, id, now.Add(pow.MaxLifetime).Unix()), keys, now)
	if err != nil {
		return nil, err
	}
	payload := signupPayload{Body: challenge.Stored.Body, SolutionKey: keys.Solution}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	crypter, err := s.keys.GetProjectCrypter(ctx, state.ProjectID, domain.EncryptionKeyPurposeSecret)
	if err != nil {
		return nil, err
	}
	encrypted, err := crypter.Encrypt(string(raw))
	if err != nil {
		return nil, err
	}
	public, err := json.Marshal(challenge.Public)
	if err != nil {
		return nil, err
	}
	proposed := &domain.SignupChallengeRecord{ProjectID: state.ProjectID, FlowID: state.ID, ID: id, ExpiresAt: challenge.Public.ExpiresAt.Unix(), Payload: encrypted, Public: string(public)}
	// No randomness, KDF or key-service calls inside retryable transactions.
	err = s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		st := tx.Statements()
		if _, err := st.LockSignupLimits(ctx, state.ProjectID, state.ID); err != nil {
			return err
		}
		var err error
		record, err = st.GetSignupChallenge(ctx, state.ProjectID, state.ID)
		if err != nil {
			return err
		}
		if record != nil && record.ExpiresAt > s.now().Add(signupRefreshBefore).Unix() {
			return nil
		} // Another issuer won: return its challenge.
		record = proposed
		if err := st.CreateSignupChallenge(ctx, proposed); err != nil {
			return err
		}
		return audit.Emit(ctx, st, audit.EmitSpec{Type: domain.EventTypeSignupChallengeIssued, Category: domain.EventCategoryAuth, ProjectID: state.ProjectID, EntityType: "challenge", EntityID: id, Payload: domain.SignupChallengePayload{}})
	})
	if err != nil {
		return nil, err
	}
	if record.ID == proposed.ID {
		return &challenge.Public, nil
	}
	return signupPublic(record)
}

func (s *signupProtection) Consume(ctx context.Context, state *domain.FlowState, proof string) error {
	if state == nil || state.ID == "" || state.ProjectID == "" {
		return domain.ErrFlowProofInvalid()
	}
	// Parsing is cheap and reads nothing, so a malformed proof spends no budget.
	parsed, err := pow.ParseProof(proof)
	if err != nil {
		return domain.ErrFlowProofInvalid()
	}
	if err := s.charge(ctx, state, false); err != nil {
		return err
	}
	record, err := s.db.Statements().GetSignupChallenge(ctx, state.ProjectID, state.ID)
	if err != nil {
		return err
	}
	if record == nil || record.ID != parsed.ChallengeID || record.ExpiresAt <= s.now().Unix() {
		return domain.ErrFlowProofInvalid()
	}
	payload, err := s.open(ctx, record)
	if err != nil {
		return fmt.Errorf("open signup proof: %w", err)
	}
	err = pow.Verify(pow.StoredChallenge{Body: payload.Body}, proof,
		signupBinding(state, record.ID, record.ExpiresAt), pow.Keys{Solution: payload.SolutionKey}, s.now())
	if err != nil {
		return domain.ErrFlowProofInvalid()
	}
	return s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		st := tx.Statements()
		// Serialize only this flow, then resample time after waiting or retrying.
		if _, err := st.LockSignupLimits(ctx, state.ProjectID, state.ID); err != nil {
			return err
		}
		consumed, err := st.ConsumeSignupChallenge(ctx, state.ProjectID, state.ID, record.ID, s.now().Unix())
		if err != nil {
			return err
		}
		if !consumed {
			return domain.ErrFlowProofInvalid()
		}
		return audit.Emit(ctx, st, audit.EmitSpec{Type: domain.EventTypeSignupChallengeConsumed, Category: domain.EventCategoryAuth, ProjectID: state.ProjectID, EntityType: "challenge", EntityID: record.ID, Payload: domain.SignupChallengePayload{}})
	})
}
