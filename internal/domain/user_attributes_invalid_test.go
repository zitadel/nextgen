package domain_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/sloggcp"
)

// The schema validator quotes the rejected value in its messages. The error
// that carries it logs where the document failed, never what it held, in
// every shape and format; the validator's error stays reachable for the key
// lookups.
func TestErrUserAttributesInvalid_logsNoValue(t *testing.T) {
	t.Parallel()
	const secret = "hunter2-the-rejected-value"
	var schema jsonschema.Schema
	require.NoError(t, json.Unmarshal([]byte(`{
		"type": "object",
		"properties": {
			"nickname": {"type": "string", "minLength": 40, "pattern": "^[a-z]+$"}
		}
	}`), &schema))
	doc := map[string]any{"nickname": secret}
	raw := schema.Validate(doc)
	require.True(t, jsonschema.IsValidationError(raw))
	require.Contains(t, raw.Error(), secret, "the validator's own text quotes the value")

	err := domain.ErrUserAttributesInvalid(raw)

	require.Len(t, domain.ValidationFailures(err), 2, "the validator's failures stay reachable")
	assert.Equal(t, []domain.AttributeKey{"nickname"}, domain.InvalidAttributeKeys(err, doc))
	parent := errors.Unwrap(err)
	assert.NotContains(t, parent.Error(), secret)
	assert.Equal(t, "/properties/nickname", parent.Error(), "the failing property once, whatever it failed")

	lines := map[string]string{}
	for name, value := range map[string]error{"full": err, "brief": err.Brief()} {
		var text, jsonOut, gcp bytes.Buffer
		slog.New(slog.NewTextHandler(&text, nil)).Error("api error", slog.Any("error", value))
		slog.New(slog.NewJSONHandler(&jsonOut, nil)).Error("api error", slog.Any("error", value))
		record := slog.NewRecord(time.Now(), slog.LevelError, "api error", 0)
		record.AddAttrs(slog.Any(sloggcp.ErrorKey, value))
		require.NoError(t, sloggcp.NewErrorReportingHandler(&gcp, nil).Handle(t.Context(), record))
		lines[name+" text"] = text.String()
		lines[name+" json"] = jsonOut.String()
		lines[name+" gcp"] = gcp.String()
	}
	for name, line := range lines {
		assert.NotContains(t, line, secret, name)
		assert.Contains(t, line, "/properties/nickname", name)
	}
}
