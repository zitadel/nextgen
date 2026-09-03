package service_test

import (
	"context"
	"errors"
	"testing"

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
	return service.NewReleaseService(service.NewPool(pool)), statements
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
		}, nil).AnyTimes()
	statements.EXPECT().
		GetFlowDefinitionByID(gomock.Any(), "proj_1", "flowdef_1").
		Return(&domain.FlowDefinition{ProjectID: "proj_1", ID: "flowdef_1", Name: "default-login"}, nil).AnyTimes()
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
