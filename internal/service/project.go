package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"sync"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectService is the project use-case surface.
type ProjectService interface {
	// Create generates a new project with server-minted secrets and persists it.
	// Returns the stored project including timestamps.
	Create(ctx context.Context, previewOrigins []string) (*domain.Project, error)

	// CreateWithIdempotency creates a project or returns the original project for
	// a replayed idempotency key with the same preview origins.
	CreateWithIdempotency(ctx context.Context, previewOrigins []string, idempotencyKey string) (*domain.Project, error)

	// Get retrieves a project by ID.
	// Returns [database.NoRowFoundError] when no project with the given ID exists.
	Get(ctx context.Context, id string) (*domain.Project, error)

	ApplyConfig(ctx context.Context, input ApplyProjectConfigInput) (*ProjectConfigApplyResult, error)
	InitClaim(ctx context.Context, input InitProjectClaimInput) (*ProjectClaimChallenge, error)
	CompleteClaim(ctx context.Context, input CompleteProjectClaimInput) (*domain.Project, error)
	GetClaimStatus(ctx context.Context, input GetProjectClaimStatusInput) (*ProjectClaimStatus, error)

	// ProjectIDByClaimStatusSecret resolves the original project secret used to
	// initiate a claim, so claim status polling can retrieve the rotated secret
	// after the project row has been updated with that rotated secret.
	ProjectIDByClaimStatusSecret(ctx context.Context, secret string) (string, error)
}

// NewProjectService returns a [ProjectService] backed by the given repository.
func NewProjectService(pool database.Pool, repo domain.ProjectRepository, ids idgen.Generator) ProjectService {
	return &projectService{
		pool:                 pool,
		repo:                 repo,
		ids:                  ids,
		now:                  func() time.Time { return time.Now().UTC() },
		claimBaseURL:         "https://zitadel.cloud/claim",
		claimChallengeTTL:    10 * time.Minute,
		idempotencyTTL:       24 * time.Hour,
		idempotentProjectIDs: make(map[string]*idempotentProjectCreate),
		claimChallenges:      make(map[string]*ProjectClaimChallenge),
	}
}

type projectService struct {
	pool              database.Pool
	repo              domain.ProjectRepository
	ids               idgen.Generator
	now               func() time.Time
	claimBaseURL      string
	claimChallengeTTL time.Duration
	idempotencyTTL    time.Duration

	mu sync.Mutex
	// MVP process-local stores. Entries are TTL-pruned to prevent unbounded
	// growth, but durable multi-replica idempotency and claim polling need a
	// repository-backed store before the cloud control plane is horizontally run.
	idempotentProjectIDs map[string]*idempotentProjectCreate
	claimChallenges      map[string]*ProjectClaimChallenge
}

var _ ProjectService = (*projectService)(nil)

type ProjectEnvironment string

const (
	ProjectEnvironmentDevelopment ProjectEnvironment = "development"
	ProjectEnvironmentPreview     ProjectEnvironment = "preview"
	ProjectEnvironmentProduction  ProjectEnvironment = "production"
)

type ProjectConfigApplyResult struct {
	Project     *domain.Project
	Environment ProjectEnvironment
	AppliedAt   time.Time
}

type ApplyProjectConfigInput struct {
	ProjectID     string
	ProjectSecret string
	Environment   ProjectEnvironment
}

type InitProjectClaimInput struct {
	ProjectID         string
	ProjectSecret     string
	ReturnURL         string
	SuggestedTeamName string
}

type CompleteProjectClaimInput struct {
	ProjectID      string
	ChallengeID    string
	TeamID         string
	CreateTeamName string
}

type GetProjectClaimStatusInput struct {
	ProjectID     string
	ChallengeID   string
	ProjectSecret string
}

type ProjectClaimStatusValue string

const (
	ProjectClaimStatusPending   ProjectClaimStatusValue = "pending"
	ProjectClaimStatusCompleted ProjectClaimStatusValue = "completed"
)

type ProjectClaimChallenge struct {
	ProjectID             string
	ChallengeID           string
	ClaimURL              string
	ExpiresAt             time.Time
	Status                ProjectClaimStatusValue
	InitiatingSecret      string
	RotatedProjectSecret  string
	RotatedSecretConsumed bool
	ClaimedAt             *time.Time
}

type ProjectClaimStatus struct {
	ProjectID            string
	ChallengeID          string
	Status               ProjectClaimStatusValue
	ExpiresAt            time.Time
	ClaimedAt            *time.Time
	RotatedProjectSecret string
}

type idempotentProjectCreate struct {
	requestHash string
	projectID   string
	expiresAt   time.Time
	done        chan struct{}
	err         error
}

func (s *projectService) Create(ctx context.Context, previewOrigins []string) (*domain.Project, error) {
	return s.create(ctx, previewOrigins)
}

func (s *projectService) CreateWithIdempotency(ctx context.Context, previewOrigins []string, idempotencyKey string) (*domain.Project, error) {
	if idempotencyKey == "" {
		return s.create(ctx, previewOrigins)
	}
	requestHash := projectCreateHash(previewOrigins)
	now := s.now()
	s.mu.Lock()
	s.cleanupTransientStateLocked(now)
	if existing, ok := s.idempotentProjectIDs[idempotencyKey]; ok {
		if existing.requestHash != requestHash {
			s.mu.Unlock()
			return nil, domain.ErrProjectIdempotencyConflict()
		}
		done := existing.done
		s.mu.Unlock()
		select {
		case <-done:
			if existing.err != nil {
				return nil, existing.err
			}
			return s.Get(ctx, existing.projectID)
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	entry := &idempotentProjectCreate{
		requestHash: requestHash,
		expiresAt:   now.Add(s.idempotencyTTL),
		done:        make(chan struct{}),
	}
	s.idempotentProjectIDs[idempotencyKey] = entry
	s.mu.Unlock()

	project, err := s.create(ctx, previewOrigins)
	s.mu.Lock()
	if err != nil {
		delete(s.idempotentProjectIDs, idempotencyKey)
		entry.err = err
	} else {
		entry.projectID = project.ID
	}
	close(entry.done)
	s.mu.Unlock()
	return project, err
}

func (s *projectService) create(ctx context.Context, previewOrigins []string) (*domain.Project, error) {
	id, err := s.ids.New("proj")
	if err != nil {
		return nil, err
	}
	projectSecret, err := s.ids.New("sk_proj")
	if err != nil {
		return nil, err
	}
	previewSecret, err := s.ids.New("sk_proj")
	if err != nil {
		return nil, err
	}

	if previewOrigins == nil {
		previewOrigins = []string{}
	}

	project := &domain.Project{
		ID:             id,
		ProjectSecret:  projectSecret,
		PreviewSecret:  previewSecret,
		PreviewOrigins: previewOrigins,
		Lifecycle:      domain.ProjectLifecycleUnclaimed,
	}
	if err := s.repo.Create(ctx, s.pool, project); err != nil {
		return nil, err
	}
	return s.get(ctx, id)
}

func (s *projectService) Get(ctx context.Context, id string) (*domain.Project, error) {
	return s.get(ctx, id)
}

func (s *projectService) ApplyConfig(ctx context.Context, input ApplyProjectConfigInput) (*ProjectConfigApplyResult, error) {
	project, err := s.get(ctx, input.ProjectID)
	if err != nil {
		return nil, err
	}
	if project.ProjectSecret != input.ProjectSecret {
		return nil, domain.ErrAuthUnauthorized(nil)
	}
	if requiresClaim(input.Environment) && project.Lifecycle != domain.ProjectLifecycleClaimed {
		return nil, domain.ErrProjectClaimRequired().WithDetails(map[string]string{
			"project_id":  input.ProjectID,
			"environment": string(input.Environment),
		})
	}
	return &ProjectConfigApplyResult{
		Project:     project,
		Environment: input.Environment,
		AppliedAt:   s.now(),
	}, nil
}

func (s *projectService) InitClaim(ctx context.Context, input InitProjectClaimInput) (*ProjectClaimChallenge, error) {
	project, err := s.get(ctx, input.ProjectID)
	if err != nil {
		return nil, err
	}
	if project.ProjectSecret != input.ProjectSecret {
		return nil, domain.ErrAuthUnauthorized(nil)
	}
	if project.Lifecycle == domain.ProjectLifecycleClaimed {
		return nil, domain.ErrProjectAlreadyClaimed()
	}
	challengeID, err := s.ids.New("claim")
	if err != nil {
		return nil, err
	}
	expiresAt := s.now().Add(s.claimChallengeTTL)
	challenge := &ProjectClaimChallenge{
		ProjectID:        input.ProjectID,
		ChallengeID:      challengeID,
		ClaimURL:         s.claimURL(input.ProjectID, challengeID, input.ReturnURL),
		ExpiresAt:        expiresAt,
		Status:           ProjectClaimStatusPending,
		InitiatingSecret: input.ProjectSecret,
	}
	s.mu.Lock()
	s.cleanupTransientStateLocked(s.now())
	s.claimChallenges[challengeID] = challenge
	s.mu.Unlock()
	return challenge, nil
}

func (s *projectService) CompleteClaim(ctx context.Context, input CompleteProjectClaimInput) (*domain.Project, error) {
	s.mu.Lock()
	challenge, ok := s.claimChallenges[input.ChallengeID]
	s.mu.Unlock()
	if !ok || challenge.ProjectID != input.ProjectID {
		return nil, domain.ErrProjectClaimNotFound()
	}
	if challenge.Status != ProjectClaimStatusCompleted && s.now().After(challenge.ExpiresAt) {
		return nil, domain.ErrProjectClaimExpired()
	}

	project, err := s.get(ctx, input.ProjectID)
	if err != nil {
		return nil, err
	}
	if project.Lifecycle == domain.ProjectLifecycleClaimed {
		return nil, domain.ErrProjectAlreadyClaimed()
	}
	rotatedSecret, err := s.ids.New("sk_proj")
	if err != nil {
		return nil, err
	}
	teamID := input.TeamID
	if teamID == "" {
		teamID, err = s.ids.New("team")
		if err != nil {
			return nil, err
		}
	}
	claimedAt := s.now()
	project.ProjectSecret = rotatedSecret
	project.Lifecycle = domain.ProjectLifecycleClaimed
	project.TeamID = teamID
	project.Tier = domain.ProjectTierFree
	project.ClaimedAt = &claimedAt
	if err := s.repo.Update(ctx, s.pool, project); err != nil {
		return nil, err
	}

	s.mu.Lock()
	challenge.Status = ProjectClaimStatusCompleted
	challenge.RotatedProjectSecret = rotatedSecret
	challenge.ClaimedAt = &claimedAt
	s.mu.Unlock()
	return s.get(ctx, input.ProjectID)
}

func (s *projectService) GetClaimStatus(ctx context.Context, input GetProjectClaimStatusInput) (*ProjectClaimStatus, error) {
	s.mu.Lock()
	s.cleanupTransientStateLocked(s.now())
	challenge, ok := s.claimChallenges[input.ChallengeID]
	if !ok || challenge.ProjectID != input.ProjectID {
		s.mu.Unlock()
		return nil, domain.ErrProjectClaimNotFound()
	}
	if challenge.Status != ProjectClaimStatusCompleted && s.now().After(challenge.ExpiresAt) {
		s.mu.Unlock()
		return nil, domain.ErrProjectClaimExpired()
	}
	if input.ProjectSecret != challenge.InitiatingSecret {
		s.mu.Unlock()
		return nil, domain.ErrAuthUnauthorized(nil)
	}
	status := &ProjectClaimStatus{
		ProjectID:   challenge.ProjectID,
		ChallengeID: challenge.ChallengeID,
		Status:      challenge.Status,
		ExpiresAt:   challenge.ExpiresAt,
		ClaimedAt:   challenge.ClaimedAt,
	}
	if challenge.Status == ProjectClaimStatusCompleted {
		if challenge.RotatedSecretConsumed {
			s.mu.Unlock()
			return nil, domain.ErrProjectSecretConsumed()
		}
		status.RotatedProjectSecret = challenge.RotatedProjectSecret
		challenge.RotatedSecretConsumed = true
	}
	s.mu.Unlock()
	return status, nil
}

func (s *projectService) ProjectIDByClaimStatusSecret(_ context.Context, secret string) (string, error) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupTransientStateLocked(now)
	for _, challenge := range s.claimChallenges {
		if challenge.InitiatingSecret == secret {
			return challenge.ProjectID, nil
		}
	}
	return "", database.NewNoRowFoundError(nil)
}

func (s *projectService) cleanupTransientStateLocked(now time.Time) {
	for key, entry := range s.idempotentProjectIDs {
		if !now.After(entry.expiresAt) {
			continue
		}
		select {
		case <-entry.done:
			delete(s.idempotentProjectIDs, key)
		default:
		}
	}
	for key, challenge := range s.claimChallenges {
		if now.After(challenge.ExpiresAt.Add(s.claimChallengeTTL)) {
			delete(s.claimChallenges, key)
		}
	}
}

func requiresClaim(environment ProjectEnvironment) bool {
	return environment == ProjectEnvironmentPreview || environment == ProjectEnvironmentProduction
}

func projectCreateHash(previewOrigins []string) string {
	if previewOrigins == nil {
		previewOrigins = []string{}
	}
	payload, _ := json.Marshal(struct {
		PreviewOrigins []string `json:"preview_origins"`
	}{PreviewOrigins: previewOrigins})
	return string(payload)
}

func (s *projectService) claimURL(projectID, challengeID, returnURL string) string {
	u, err := url.Parse(s.claimBaseURL)
	if err != nil {
		return s.claimBaseURL
	}
	query := u.Query()
	query.Set("project_id", projectID)
	query.Set("challenge_id", challengeID)
	if returnURL != "" {
		query.Set("return_url", returnURL)
	}
	u.RawQuery = query.Encode()
	return u.String()
}

func (s *projectService) get(ctx context.Context, id string) (*domain.Project, error) {
	project, err := s.repo.Get(ctx, s.pool, id)
	if err != nil {
		var noRow *database.NoRowFoundError
		if errors.As(err, &noRow) {
			return nil, domain.ErrProjectNotFound().WithParent(err)
		}
		return nil, err
	}
	if project.Lifecycle == "" {
		project.Lifecycle = domain.ProjectLifecycleUnclaimed
	}
	return project, nil
}
