package domain_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	testCanonicalBase = "https://example.test/schemas/v1"
	testLegacyBase    = "https://nextgen.com/api/schemas"
)

func testBases() domain.BuiltinSchemaBases {
	return domain.NewBuiltinSchemaBases(testCanonicalBase, testLegacyBase)
}

func TestNewBuiltinSchemaBases(t *testing.T) {
	t.Run("trims trailing slashes and drops a legacy base equal to the canonical one", func(t *testing.T) {
		b := domain.NewBuiltinSchemaBases(testCanonicalBase+"/", testCanonicalBase, testLegacyBase+"/", "")
		assert.Equal(t, testCanonicalBase, b.Canonical())
		assert.Equal(t, []string{
			"https://nextgen.com/api/schemas/x.json",
			testCanonicalBase + "/x.json",
		}, b.Equivalents("https://nextgen.com/api/schemas/x.json"))
	})
	t.Run("an empty canonical base disables the namespace, legacy bases included", func(t *testing.T) {
		b := domain.NewBuiltinSchemaBases("", testLegacyBase)
		_, ok := b.RelPath(testLegacyBase + "/user-schema.json")
		assert.False(t, ok)
		assert.Equal(t, testLegacyBase+"/user-schema.json", b.Canonicalize(testLegacyBase+"/user-schema.json"))
	})
	t.Run("the real legacy bases name nextgen.com", func(t *testing.T) {
		assert.Contains(t, domain.LegacyBuiltinSchemaBases, "https://nextgen.com/api/schemas")
	})
}

func TestBuiltinSchemaBases_Paths(t *testing.T) {
	b := testBases()

	rel, ok := b.RelPath(testLegacyBase + "/user-schema.json")
	assert.True(t, ok)
	assert.Equal(t, "user-schema.json", rel)

	rel, ok = b.RelPath(testCanonicalBase + "/default-human-user.json")
	assert.True(t, ok)
	assert.Equal(t, "default-human-user.json", rel)

	_, ok = b.RelPath("https://nextgen.com/api/schemasx/user-schema.json")
	assert.False(t, ok, "a lookalike prefix is not under the base")

	assert.Equal(t, testCanonicalBase+"/user-schema.json", b.Canonicalize(testLegacyBase+"/user-schema.json"))
	assert.Equal(t, testCanonicalBase+"/user-schema.json", b.Canonicalize(testCanonicalBase+"/user-schema.json"))
	assert.Equal(t, "https://acme.test/s.json", b.Canonicalize("https://acme.test/s.json"))

	assert.Equal(t, []string{"sch_123"}, b.Equivalents("sch_123"))
	assert.Equal(t, []string{testLegacyBase}, b.Equivalents(testLegacyBase), "the base itself names no built-in")
	assert.Equal(t, []string{
		testCanonicalBase + "/default-human-user.json",
		testLegacyBase + "/default-human-user.json",
	}, b.Equivalents(testCanonicalBase+"/default-human-user.json"))
}

func TestBuiltinSchemaBases_GetJSONSchema(t *testing.T) {
	ctx := context.Background()
	current := testCanonicalBase + "/default-human-user.json"
	legacy := testLegacyBase + "/default-human-user.json"

	t.Run("the exact row wins", func(t *testing.T) {
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", legacy).Return(&domain.JSONSchema{URL: legacy}, nil)

		got, err := testBases().GetJSONSchema(ctx, store, "proj-1", legacy)
		require.NoError(t, err)
		assert.Equal(t, legacy, got.URL)
	})
	t.Run("a legacy URL finds the row seeded under the canonical base", func(t *testing.T) {
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		gomock.InOrder(
			store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", legacy).Return(nil, database.NewNoRowFoundError(nil)),
			store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", current).Return(&domain.JSONSchema{URL: current}, nil),
		)

		got, err := testBases().GetJSONSchema(ctx, store, "proj-1", legacy)
		require.NoError(t, err)
		assert.Equal(t, current, got.URL)
	})
	t.Run("a canonical URL finds the row a project seeded under a legacy base", func(t *testing.T) {
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		gomock.InOrder(
			store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", current).Return(nil, database.NewNoRowFoundError(nil)),
			store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", legacy).Return(&domain.JSONSchema{URL: legacy}, nil),
		)

		got, err := testBases().GetJSONSchema(ctx, store, "proj-1", current)
		require.NoError(t, err)
		assert.Equal(t, legacy, got.URL)
	})
	t.Run("missing everywhere reports the lookup of the URL asked for", func(t *testing.T) {
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", gomock.Any()).Return(nil, database.NewNoRowFoundError(nil)).Times(2)

		_, err := testBases().GetJSONSchema(ctx, store, "proj-1", legacy)
		var noRow *database.NoRowFoundError
		assert.True(t, errors.As(err, &noRow))
	})
	t.Run("a failed read is not papered over by the twin", func(t *testing.T) {
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		boom := errors.New("connection reset")
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", legacy).Return(nil, boom)

		_, err := testBases().GetJSONSchema(ctx, store, "proj-1", legacy)
		assert.ErrorIs(t, err, boom)
	})
	t.Run("a URL outside the namespace is read once", func(t *testing.T) {
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", "sch_1").Return(nil, database.NewNoRowFoundError(nil))

		_, err := testBases().GetJSONSchema(ctx, store, "proj-1", "sch_1")
		require.Error(t, err)
	})
}

func TestWithBuiltinSchemaAliases(t *testing.T) {
	ctx := context.Background()
	current := testCanonicalBase + "/default-human-user.json"
	legacy := testLegacyBase + "/default-human-user.json"

	store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
	store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", legacy).Return(nil, database.NewNoRowFoundError(nil))
	store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", current).Return(&domain.JSONSchema{URL: current}, nil)
	created := &domain.JSONSchema{URL: "sch_1"}
	store.EXPECT().CreateJSONSchema(gomock.Any(), created).Return(nil)

	aliasing := domain.WithBuiltinSchemaAliases(store, testBases())

	got, err := aliasing.GetJSONSchemaByID(ctx, "proj-1", legacy)
	require.NoError(t, err)
	assert.Equal(t, current, got.URL)
	require.NoError(t, aliasing.CreateJSONSchema(ctx, created))
}

// failingTransport fails the test on any request: nothing under the built-in
// namespace may leave the process.
type failingTransport struct{ t *testing.T }

func (f failingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	f.t.Errorf("unexpected fetch of %s", req.URL)
	return nil, errors.New("fetch refused by test")
}

func TestJSONSchemaResolver_LegacyBuiltinBase(t *testing.T) {
	ctx := context.Background()
	base := mustParseURL(t, testCanonicalBase)
	noFetch := &http.Client{Transport: failingTransport{t}}

	t.Run("a built-in named under a legacy base resolves from the embedded templates", func(t *testing.T) {
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		r := domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), 0, 0, noFetch, base)

		schema, err := r.Resolve(ctx, store, "proj-1", testLegacyBase+"/user-schema.json", nil)
		require.NoError(t, err)
		require.NotNil(t, schema)
	})
	t.Run("a stored row named under a legacy base resolves from the canonical twin", func(t *testing.T) {
		const doc = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}`
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", testLegacyBase+"/default-human-user.json").Return(nil, database.NewNoRowFoundError(nil))
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", testCanonicalBase+"/default-human-user.json").Return(&domain.JSONSchema{Schema: []byte(doc)}, nil)
		r := domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), 0, 0, noFetch, base)

		schema, err := r.Resolve(ctx, store, "proj-1", testLegacyBase+"/default-human-user.json", nil)
		require.NoError(t, err)
		require.NotNil(t, schema)
	})
	t.Run("a missing row in the namespace is never fetched", func(t *testing.T) {
		store := domainmock.NewMockJSONSchemaStore(gomock.NewController(t))
		store.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj-1", gomock.Any()).Return(nil, database.NewNoRowFoundError(nil)).Times(2)
		r := domain.NewJSONSchemaResolver(mustJSONSchemaCache(t, 128), 0, 0, noFetch, base)

		_, err := r.Resolve(ctx, store, "proj-1", testLegacyBase+"/default-human-user.json", nil)
		require.Error(t, err)
	})
}

func TestSchemaValidator_LegacyMetaSchema(t *testing.T) {
	v, err := domain.NewSchemaValidator(testCanonicalBase)
	require.NoError(t, err)

	legacy, err := v.GetBuiltinSchema(testLegacyBase + "/user-schema.json")
	require.NoError(t, err)
	require.NotNil(t, legacy)

	_, err = v.GetBuiltinSchema("https://elsewhere.test/user-schema.json")
	require.ErrorIs(t, err, domain.ErrUnknownSchemaURI)

	latest, err := v.LatestSchemaURI(domain.SchemaKindUser)
	require.NoError(t, err)
	assert.Equal(t, testCanonicalBase+"/user-schema.json", latest, "new documents are stamped with the canonical base")

	assert.Equal(t, testCanonicalBase, v.BuiltinBases().Canonical())
	var nilValidator *domain.SchemaValidator
	assert.Empty(t, nilValidator.BuiltinBases().Canonical())
}
