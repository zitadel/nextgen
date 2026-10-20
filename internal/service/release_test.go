package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedReleaseService(t *testing.T) (service.ReleaseService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	return service.NewReleaseService(service.NewPool(pool), nil, nil, nil, nil, testBuiltinBases), statements
}

// testBuiltinBases is the built-in schema namespace the release tests run
// under: example.com rows are outside it, so pointers resolve as written.
var testBuiltinBases = domain.NewBuiltinSchemaBases("https://schemas.test/builtin/v1", "https://schemas.test/builtin/v0")

// loginFlow collects email, which human-user-v2.json dropped.
func loginFlow() *domain.FlowDefinition {
	return &domain.FlowDefinition{
		ProjectID:  "proj_1",
		ID:         "flowdef_1",
		Name:       "default-login",
		UserSchema: "human-user",
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:        "identify",
				Fields:      []domain.Field{"email"},
				Actions:     []domain.FlowStepAction{{Name: "submit", Kind: domain.FlowActionKindSubmit, Primary: true}},
				Transitions: map[string]domain.FlowStepTransition{"submit": {Target: "done"}},
			},
			{Name: "done", Complete: new(domain.FlowStepCompleteRedirect)},
		},
	}
}

// expectHandleReads stubs the per-kind revision reads that resolve a handle:
// a schema by its objectType, a flow definition by its name, and branding by
// nothing at all.
func expectHandleReads(statements *servicemocks.MockAllStatements) {
	statements.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.com/human-user.json").
		Return(&domain.JSONSchema{
			ProjectID:  "proj_1",
			URL:        "https://example.com/human-user.json",
			ObjectType: new("human-user"),
			Schema: []byte(`{"type": "object", "x-identifier": "email",
				"x-auth-methods": {"password": {"enabled": true}},
				"properties": {"email": {"type": "string", "format": "email", "x-unique": "team"}}}`),
		}, nil).AnyTimes()
	statements.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.com/human-user-v2.json").
		Return(&domain.JSONSchema{
			ProjectID:  "proj_1",
			URL:        "https://example.com/human-user-v2.json",
			ObjectType: new("human-user"),
			Schema: []byte(`{"type": "object",
				"x-auth-methods": {"password": {"enabled": true}},
				"properties": {"name": {"type": "string"}}}`),
		}, nil).AnyTimes()
	statements.EXPECT().
		GetFlowDefinitionByID(gomock.Any(), "proj_1", "flowdef_1").
		Return(loginFlow(), nil).AnyTimes()
	statements.EXPECT().
		GetIDPConnectionRevision(gomock.Any(), "proj_1", "idprev_1").
		Return(&domain.IDPConnection{ProjectID: "proj_1", ID: "idp_1", Slug: "google", RevisionID: "idprev_1"}, nil).AnyTimes()
	statements.EXPECT().
		GetBrandingByID(gomock.Any(), "proj_1", "brnd_1").
		Return(&domain.Branding{ProjectID: "proj_1", ID: "brnd_1"}, nil).AnyTimes()
}

func releaseInput() service.CreateReleaseInput {
	return service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers: []service.CreateReleasePointer{
			{Kind: domain.ReleasePointerKindSchema, RevisionID: "https://example.com/human-user.json"},
			{Kind: domain.ReleasePointerKindFlowDefinition, RevisionID: "flowdef_1"},
			{Kind: domain.ReleasePointerKindBranding, RevisionID: "brnd_1"},
		},
		Message: new("initial import"),
	}
}

// The handle is never supplied by the caller: it is read from the revision
// being pinned, so a resource is always recorded under the identity it
// declares and there is no mismatch to report.
func TestReleaseServiceCreateResolvesHandles(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)

	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))
	statements.EXPECT().
		CreateRelease(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, rel *domain.Release) error {
			rel.ID = "rel_test01"
			return nil
		})

	result, err := svc.Create(t.Context(), releaseInput())
	require.NoError(t, err)
	assert.True(t, result.Created)

	// Sorted by (kind, handle) inside the domain constructor, so branding
	// leads whatever order the caller sent.
	assert.Equal(t, []domain.ReleasePointer{
		{Kind: domain.ReleasePointerKindBranding, Handle: "default", RevisionID: "brnd_1"},
		{Kind: domain.ReleasePointerKindFlowDefinition, Handle: "default-login", RevisionID: "flowdef_1"},
		{Kind: domain.ReleasePointerKindSchema, Handle: "human-user", RevisionID: "https://example.com/human-user.json"},
	}, result.Release.Pointers)
}

// A release records the identity that assembled it, taken from the request's
// actor context rather than from the request body.
func TestReleaseServiceCreateRecordsActor(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)

	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))
	statements.EXPECT().CreateRelease(gomock.Any(), gomock.Any()).Return(nil)

	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ActorID:   new("user_1"),
		ActorType: new(domain.EventActorTypeHuman),
	})
	result, err := svc.Create(ctx, releaseInput())
	require.NoError(t, err)
	assert.Equal(t, "user_1", *result.Release.Metadata.CreatedBy)
	assert.Equal(t, domain.EventActorTypeHuman, *result.Release.Metadata.CreatedByType)
}

// A release assembled with no actor on the context records neither field,
// rather than falling back to a placeholder identity.
func TestReleaseServiceCreateWithoutActor(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)

	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))
	statements.EXPECT().CreateRelease(gomock.Any(), gomock.Any()).Return(nil)

	result, err := svc.Create(t.Context(), releaseInput())
	require.NoError(t, err)
	assert.Nil(t, result.Release.Metadata.CreatedBy)
	assert.Nil(t, result.Release.Metadata.CreatedByType)
}

// Re-submitting a pinned set returns the release that already holds it and
// writes nothing: CreateRelease is never called, so a re-deploy of unchanged
// content does not burn an id.
func TestReleaseServiceCreateIsIdempotent(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)

	existing := &domain.Release{ProjectID: "proj_1", ID: "rel_existing"}
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(existing, nil)

	input := releaseInput()
	input.Message = new("a different message entirely")
	result, err := svc.Create(t.Context(), input)
	require.NoError(t, err)
	assert.False(t, result.Created)
	assert.Equal(t, "rel_existing", result.Release.ID)
}

// Two callers pinning the same set at once: the unique index rejects the
// loser's insert, and the winner's release is the answer, since the loser
// asked for a release pinning exactly that set and one now exists.
func TestReleaseServiceCreateResolvesRace(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)

	winner := &domain.Release{ProjectID: "proj_1", ID: "rel_winner"}
	gomock.InOrder(
		statements.EXPECT().
			GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
			Return(nil, new(database.NoRowFoundError)),
		statements.EXPECT().
			CreateRelease(gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("releases", "releases_project_id_content_hash_key", nil)),
		statements.EXPECT().
			GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
			Return(winner, nil),
	)

	result, err := svc.Create(t.Context(), releaseInput())
	require.NoError(t, err)
	assert.False(t, result.Created)
	assert.Equal(t, "rel_winner", result.Release.ID)
}

// The project can be deleted between the revision reads and the insert. The
// foreign key is what catches it, and it is the caller's answer rather than a
// generic internal error, since the release they asked for can never exist.
func TestReleaseServiceCreateRejectsDeletedProject(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)

	gomock.InOrder(
		statements.EXPECT().
			GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
			Return(nil, new(database.NoRowFoundError)),
		statements.EXPECT().
			CreateRelease(gomock.Any(), gomock.Any()).
			Return(database.NewForeignKeyError("releases", "releases_project_id_fkey", nil)),
	)

	_, err := svc.Create(t.Context(), releaseInput())
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseProjectNotFound().Code, domErr.Code)
}

func TestReleaseServiceCreateRejectsUnknownRevision(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	statements.EXPECT().
		GetFlowDefinitionByID(gomock.Any(), "proj_1", "flowdef_gone").
		Return(nil, new(database.NoRowFoundError))

	_, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers: []service.CreateReleasePointer{
			{Kind: domain.ReleasePointerKindFlowDefinition, RevisionID: "flowdef_gone"},
		},
	})
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseRevisionNotFound(nil).Code, domErr.Code)
	// The detail names the pointer, since a release pins many and the code
	// alone does not say which one failed.
	assert.Contains(t, domErr.Details, "flowdef_gone")
}

// A schema registered by URL whose document was never parsed declares no
// objectType, so nothing says which resource it is a revision of. That is its
// own failure, not a missing revision.
func TestReleaseServiceCreateRejectsSchemaWithoutObjectType(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	statements.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.com/unparsed.json").
		Return(&domain.JSONSchema{ProjectID: "proj_1", URL: "https://example.com/unparsed.json"}, nil)

	_, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers: []service.CreateReleasePointer{
			{Kind: domain.ReleasePointerKindSchema, RevisionID: "https://example.com/unparsed.json"},
		},
	})
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseRevisionUnpinnable(nil).Code, domErr.Code)
}

func TestReleaseServiceCreateRejectsMissingUserSchema(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))

	_, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers: []service.CreateReleasePointer{
			{Kind: domain.ReleasePointerKindFlowDefinition, RevisionID: "flowdef_1"},
			{Kind: domain.ReleasePointerKindBranding, RevisionID: "brnd_1"},
		},
	})
	assert.ErrorIs(t, err, domain.ErrReleaseUnresolvedReference())
}

// A set already released answers with that release; validation is skipped.
func TestReleaseServiceCreateReturnsExistingWithoutValidating(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)
	existing := &domain.Release{ProjectID: "proj_1", ID: "rel_existing"}
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(existing, nil)

	result, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers:  []service.CreateReleasePointer{{Kind: domain.ReleasePointerKindFlowDefinition, RevisionID: "flowdef_1"}},
	})
	require.NoError(t, err)
	assert.Same(t, existing, result.Release)
	assert.False(t, result.Created)
}

func TestReleaseServiceCreateReferencesIDPConnection(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))
	statements.EXPECT().CreateRelease(gomock.Any(), gomock.Any()).Return(nil)

	result, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers: []service.CreateReleasePointer{
			{Kind: domain.ReleasePointerKindIDP, RevisionID: "idprev_1"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, []domain.ReleasePointer{
		{Kind: domain.ReleasePointerKindIDP, Handle: "google", RevisionID: "idprev_1"},
	}, result.Release.Pointers)
}

func TestReleaseServiceCreateRejectsUnknownIDPRevision(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	statements.EXPECT().
		GetIDPConnectionRevision(gomock.Any(), "proj_1", "idprev_gone").
		Return(nil, new(database.NoRowFoundError))

	_, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers:  []service.CreateReleasePointer{{Kind: domain.ReleasePointerKindIDP, RevisionID: "idprev_gone"}},
	})
	assert.ErrorIs(t, err, domain.ErrReleaseRevisionNotFound(nil))
}

func TestReleaseServiceCreateRejectsFlowNotFittingItsSchema(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	expectHandleReads(statements)
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))

	_, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers: []service.CreateReleasePointer{
			{Kind: domain.ReleasePointerKindFlowDefinition, RevisionID: "flowdef_1"},
			{Kind: domain.ReleasePointerKindSchema, RevisionID: "https://example.com/human-user-v2.json"},
		},
	})
	assert.ErrorIs(t, err, domain.ErrReleaseInvalid(nil, nil))
}

// Two revisions of one resource cannot both be pinned: the release would
// describe two states of the project at once. The handles collide only after
// resolution, so this is caught with the revisions already read.
func TestReleaseServiceCreateRejectsSameResourceTwice(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	statements.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.com/human-user.json?v=1").
		Return(&domain.JSONSchema{ProjectID: "proj_1", ObjectType: new("human-user")}, nil)
	statements.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", "https://example.com/human-user.json?v=2").
		Return(&domain.JSONSchema{ProjectID: "proj_1", ObjectType: new("human-user")}, nil)

	_, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers: []service.CreateReleasePointer{
			{Kind: domain.ReleasePointerKindSchema, RevisionID: "https://example.com/human-user.json?v=1"},
			{Kind: domain.ReleasePointerKindSchema, RevisionID: "https://example.com/human-user.json?v=2"},
		},
	})
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseInvalid(nil, nil).Code, domErr.Code)
}

func TestReleaseServiceGetUnknownIsNotFound(t *testing.T) {
	svc, statements := newMockedReleaseService(t)
	statements.EXPECT().
		GetReleaseByID(gomock.Any(), "proj_1", "rel_gone").
		Return(nil, new(database.NoRowFoundError))

	_, err := svc.Get(t.Context(), "proj_1", "rel_gone")
	require.Error(t, err)

	domErr, ok := errors.AsType[domain.Error](err)
	require.True(t, ok)
	assert.Equal(t, domain.ErrReleaseNotFound().Code, domErr.Code)
}

// A schema pointer may name a built-in schema's `$id` under a base the
// project was not seeded under: the release pins the row that was found,
// under the base it is stored at.
func TestReleaseServiceCreateResolvesBuiltinSchemaUnderAnotherBase(t *testing.T) {
	const asked = "https://schemas.test/builtin/v0/default-human-user.json"
	const stored = "https://schemas.test/builtin/v1/default-human-user.json"

	svc, statements := newMockedReleaseService(t)
	statements.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", asked).
		Return(nil, new(database.NoRowFoundError))
	statements.EXPECT().
		GetJSONSchemaByID(gomock.Any(), "proj_1", stored).
		Return(&domain.JSONSchema{
			ProjectID:  "proj_1",
			URL:        stored,
			ObjectType: new("human-user"),
			Schema: []byte(`{"type": "object", "x-identifier": "email",
				"x-auth-methods": {"password": {"enabled": true}},
				"properties": {"email": {"type": "string", "format": "email", "x-unique": "team"}}}`),
		}, nil)
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))
	statements.EXPECT().
		CreateRelease(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, rel *domain.Release) error {
			rel.ID = "rel_test02"
			return nil
		})

	result, err := svc.Create(t.Context(), service.CreateReleaseInput{
		ProjectID: "proj_1",
		Pointers:  []service.CreateReleasePointer{{Kind: domain.ReleasePointerKindSchema, RevisionID: asked}},
	})
	require.NoError(t, err)
	assert.Equal(t, []domain.ReleasePointer{
		{Kind: domain.ReleasePointerKindSchema, Handle: "human-user", RevisionID: stored},
	}, result.Release.Pointers)
}

func TestReleaseServiceRevoke(t *testing.T) {
	revokedAt := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	unrevoked := &domain.Release{ProjectID: "proj_1", ID: "rel_1", ContentHash: "abc"}
	primary := domain.Origin{Pattern: "https://app.acme.com", Kind: domain.OriginKindPrimary}
	noPreviews := &database.ListResult[*domain.Preview]{}

	t.Run("revokes a release nothing serves", func(t *testing.T) {
		svc, statements := newMockedReleaseService(t)
		statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(unrevoked, nil)
		statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1", Origins: []domain.Origin{primary}}, nil)
		statements.EXPECT().ListPreviews(gomock.Any(), gomock.Any()).Return(noPreviews, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), "proj_1", []string{primary.Pattern}).
			Return([]domain.OriginDeployment{{Origin: primary.Pattern, DeploymentID: "dep_2", ReleaseID: "rel_2"}}, nil)
		revoked := *unrevoked
		revoked.RevokedAt = &revokedAt
		statements.EXPECT().RevokeRelease(gomock.Any(), "proj_1", "rel_1").Return(&revoked, nil)

		got, err := svc.Revoke(t.Context(), "proj_1", "rel_1")
		require.NoError(t, err)
		assert.Equal(t, &revokedAt, got.RevokedAt)
	})

	t.Run("a revoked release comes back unchanged", func(t *testing.T) {
		svc, statements := newMockedReleaseService(t)
		revoked := *unrevoked
		revoked.RevokedAt = &revokedAt
		statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(&revoked, nil)

		got, err := svc.Revoke(t.Context(), "proj_1", "rel_1")
		require.NoError(t, err)
		assert.Same(t, &revoked, got)
	})

	t.Run("an origin still serving it", func(t *testing.T) {
		svc, statements := newMockedReleaseService(t)
		statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(unrevoked, nil)
		statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1", Origins: []domain.Origin{primary}}, nil)
		statements.EXPECT().ListPreviews(gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.Preview]{
			Items: []*domain.Preview{{ProjectID: "proj_1", Origin: "https://pr-1-acmeinc.vercel.app"}},
		}, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), "proj_1", []string{primary.Pattern, "https://pr-1-acmeinc.vercel.app"}).
			Return([]domain.OriginDeployment{
				{Origin: "https://pr-1-acmeinc.vercel.app", DeploymentID: "dep_3", ReleaseID: "rel_1"},
				{Origin: primary.Pattern, DeploymentID: "dep_2", ReleaseID: "rel_2"},
			}, nil)

		_, err := svc.Revoke(t.Context(), "proj_1", "rel_1")
		require.Error(t, err)
		de, ok := err.(domain.Error)
		require.True(t, ok)
		assert.Equal(t, domain.ErrReleaseInUse(domain.ReleaseInUseDetails{}).Code, de.Code)
		assert.Equal(t, domain.ReleaseInUseDetails{Origins: []domain.ReleaseInUseOrigin{
			{Origin: "https://pr-1-acmeinc.vercel.app", DeploymentID: "dep_3"},
		}}, de.Details)
	})

	t.Run("an unknown release", func(t *testing.T) {
		svc, statements := newMockedReleaseService(t)
		statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_x").Return(nil, database.NewNoRowFoundError(nil))

		_, err := svc.Revoke(t.Context(), "proj_1", "rel_x")
		assert.ErrorIs(t, err, domain.ErrReleaseNotFound())
	})
}
