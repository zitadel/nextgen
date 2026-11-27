package api

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const compactApplication = `{"application":{"slug":"shop","name":"Shop <1>","clients":[{"slug":"web","type":"confidential","grant_types":["authorization_code"],"redirect_uris":["https://shop.example.com/callback"]}]}}`

// A retry matches the first request by the hash of the document the handler
// passes on, so every encoding of one document must reach the service as the
// same bytes.
func TestPublishApplicationPassesOneEncodingAndTheKey(t *testing.T) {
	t.Parallel()
	encodings := map[string]string{
		"compact":       compactApplication,
		"whitespace":    "{ \"application\" : {\n  \"slug\": \"shop\",\n  \"name\": \"Shop <1>\",\n  \"clients\": [ { \"slug\": \"web\", \"type\": \"confidential\", \"grant_types\": [ \"authorization_code\" ], \"redirect_uris\": [ \"https://shop.example.com/callback\" ] } ]\n} }",
		"key order":     `{"application":{"clients":[{"redirect_uris":["https://shop.example.com/callback"],"grant_types":["authorization_code"],"type":"confidential","slug":"web"}],"name":"Shop <1>","slug":"shop"}}`,
		"escaped angle": strings.Replace(compactApplication, "<", "\\u003c", 1),
	}
	sent := map[string]string{}
	for name, body := range encodings {
		f := newGateFixture(t, true, true)
		var req api.CreateApplicationRequest
		require.NoError(t, req.UnmarshalJSON([]byte(body)), name)
		f.applications.EXPECT().CreateOrReviseRegistered(gomock.Any(), contractHome, gomock.Any(), "key-1").DoAndReturn(
			func(_ context.Context, _ string, document []byte, _ string) (*service.CreateApplicationOutput, error) {
				sent[name] = string(document)
				return nil, domain.ErrApplicationNotFound()
			},
		)

		_, err := f.handler.PublishApplication(WithScopeContext(t.Context(), secretPrincipal.scope), &req, api.PublishApplicationParams{
			ProjectID:      api.ProjectID(contractHome),
			IdempotencyKey: api.NewOptString("key-1"),
		})
		require.ErrorIs(t, err, domain.ErrApplicationNotFound(), name)
	}
	require.Len(t, sent, len(encodings))
	for name, document := range sent {
		assert.Equal(t, sent["compact"], document, name)
	}
}
