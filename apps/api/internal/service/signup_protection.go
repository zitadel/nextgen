package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
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
	signupIssuanceLimit     = 60
	signupVerificationLimit = 120
)

type signupProtection struct {
	db   StatementPool
	keys KeyService
	now  func() time.Time
}

func NewSignupProtection(db StatementPool, keys KeyService) SignupProtection {
	return &signupProtection{db: db, keys: keys, now: time.Now}
}

// The independent per-challenge MAC keys never leave encrypted storage. The
// existing project secret key wraps them; rotation uses the JWE's key ID.
type signupPayload struct {
	Public                    pow.PublicChallenge
	Body, MAC                 []byte
	ChallengeKey, SolutionKey [32]byte
}

func signupBinding(state *domain.FlowState, id string, expires int64) pow.Binding {
	return pow.Binding{ProfileID: "pbkdf2_sha256_5000_l1", ProjectID: state.ProjectID,
		Operation: "create_user", OperationInstanceID: state.ID, ChallengeID: id, ExpiresAt: expires}
}

// charge commits before cryptographic work. Fixed project-wide budgets also
// bound new-flow/IP rotation and work across replicas; no forwarded IP trust is
// needed. Reads of an existing live challenge do not spend issuance budget.
func (s *signupProtection) charge(ctx context.Context, project string, issue bool) error {
	now := s.now().Unix()
	return s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		st := tx.Statements()
		if err := st.LockProject(ctx, project); err != nil {
			return err
		}
		limits, err := st.GetSignupLimits(ctx, project)
		if err != nil {
			return err
		}
		fresh := limits == nil
		if fresh || now >= limits.WindowStart+60 {
			limits = &domain.SignupLimits{ProjectID: project, WindowStart: now}
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
		if fresh {
			return st.InsertSignupLimits(ctx, limits)
		}
		return st.UpdateSignupLimits(ctx, limits)
	})
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
	if record != nil && record.ExpiresAt > now.Unix() {
		payload, err := s.open(ctx, record)
		if err != nil {
			return nil, fmt.Errorf("open signup challenge: %w", err)
		}
		return &payload.Public, nil
	}
	if err := s.charge(ctx, state.ProjectID, true); err != nil {
		return nil, err
	}
	id, err := s.db.Statements().NewManagedID(string(domain.PrefixChallenge))
	if err != nil {
		return nil, err
	}
	keys := pow.Keys{}
	if _, err := rand.Read(keys.Challenge[:]); err != nil {
		return nil, err
	}
	if _, err := rand.Read(keys.Solution[:]); err != nil {
		return nil, err
	}
	challenge, err := pow.Issue(signupBinding(state, id, now.Add(pow.MaxLifetime).Unix()), keys, now)
	if err != nil {
		return nil, err
	}
	payload := signupPayload{Public: challenge.Public, Body: challenge.Stored.Body, MAC: challenge.Stored.MAC, ChallengeKey: keys.Challenge, SolutionKey: keys.Solution}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	crypter, err := s.keys.GetProjectCrypter(ctx, state.ProjectID, domain.EncryptionKeyPurposeSecret)
	if err != nil {
		return nil, err
	}
	encrypted, err := crypter.Encrypt(string(raw))
	clear(raw)
	if err != nil {
		return nil, err
	}
	proposed := &domain.SignupChallengeRecord{ProjectID: state.ProjectID, FlowID: state.ID, ID: id, ExpiresAt: challenge.Public.ExpiresAt.Unix(), Payload: encrypted}
	// No randomness, KDF or key-service calls inside retryable transactions.
	err = s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		st := tx.Statements()
		if err := st.LockProject(ctx, state.ProjectID); err != nil {
			return err
		}
		if err := st.DeleteExpiredSignupChallenges(ctx, state.ProjectID, now.Unix()); err != nil {
			return err
		}
		var err error
		record, err = st.GetSignupChallenge(ctx, state.ProjectID, state.ID)
		if err != nil {
			return err
		}
		if record != nil {
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
	other, err := s.open(ctx, record)
	if err != nil {
		return nil, err
	}
	return &other.Public, nil
}

func (s *signupProtection) Consume(ctx context.Context, state *domain.FlowState, proof string) error {
	if state == nil || state.ID == "" || state.ProjectID == "" {
		return domain.ErrFlowProofInvalid()
	}
	if err := s.charge(ctx, state.ProjectID, false); err != nil {
		return err
	}
	parsed, err := pow.ParseProof(proof)
	if err != nil {
		return domain.ErrFlowProofInvalid()
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
	err = pow.Verify(pow.StoredChallenge{Body: payload.Body, MAC: payload.MAC}, proof,
		signupBinding(state, record.ID, record.ExpiresAt), pow.Keys{Challenge: payload.ChallengeKey, Solution: payload.SolutionKey}, s.now())
	if err != nil {
		return domain.ErrFlowProofInvalid()
	}
	return s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		st := tx.Statements()
		// Same lock order as issuance/expiry cleanup and its project FK writes.
		if err := st.LockProject(ctx, state.ProjectID); err != nil {
			return err
		}
		// Waiting for the lock or retrying the transaction can outlast the proof.
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
