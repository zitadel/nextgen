package ssoevent_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/instrumentation/ssoevent"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

func emit(t *testing.T, e ssoevent.Event) map[string]any {
	t.Helper()
	var logs bytes.Buffer
	ctx := zlog.WithLoggingContext(context.Background(), slog.New(slog.NewJSONHandler(&logs, nil)))
	ssoevent.Emit(ctx, e)
	var record map[string]any
	require.NoError(t, json.Unmarshal(logs.Bytes(), &record))
	return record
}

func TestEmit(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		event ssoevent.Event
		want  map[string]any
	}{
		{
			name:  "a success is info with the phase and ids",
			event: ssoevent.Event{Slug: "google", FlowID: "att_1", Phase: ssoevent.PhaseCeremonyStarted},
			want:  map[string]any{"level": "INFO", "msg": "sso attempt", "slug": "google", "flow_id": "att_1", "phase": "ceremony_started", "status": "ok"},
		},
		{
			name:  "a failure is a warning with its reason and the side it blames",
			event: ssoevent.Event{Slug: "google", FlowID: "att_1", Phase: ssoevent.PhaseExchangeFinished, Reason: ssoevent.ReasonExchangeFailed},
			want:  map[string]any{"level": "WARN", "phase": "exchange_finished", "status": "failed", "reason": "exchange_failed", "side": "provider"},
		},
		{
			name:  "a journey reason blames the journey",
			event: ssoevent.Event{Slug: "google", Phase: ssoevent.PhaseResolved, Reason: ssoevent.ReasonCreationDisabled},
			want:  map[string]any{"reason": "creation_disabled", "side": "journey"},
		},
		{
			name:  "a resolution carries its result",
			event: ssoevent.Event{Slug: "google", Phase: ssoevent.PhaseResolved, Result: ssoevent.ResultLinked},
			want:  map[string]any{"result": "linked", "status": "ok"},
		},
		{
			name:  "claim names are sorted and carry no values",
			event: ssoevent.Event{Slug: "google", Phase: ssoevent.PhaseExchangeFinished, ClaimNames: []string{"name", "email"}},
			want:  map[string]any{"claims": []any{"email", "name"}},
		},
		{
			name:  "a slug that is not a slug is dropped",
			event: ssoevent.Event{Slug: "google?code=CANARY", Phase: ssoevent.PhaseCallbackReceived, Reason: ssoevent.ReasonStateInvalid},
			want:  map[string]any{"slug": ""},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			record := emit(t, tt.event)
			for key, value := range tt.want {
				assert.Equal(t, value, record[key], key)
			}
		})
	}
}

func TestReason_Side(t *testing.T) {
	t.Parallel()
	provider := []ssoevent.Reason{
		ssoevent.ReasonProviderDenied, ssoevent.ReasonProviderError, ssoevent.ReasonDiscoveryFailed,
		ssoevent.ReasonExchangeFailed, ssoevent.ReasonIDTokenInvalid, ssoevent.ReasonUserinfoFailed,
	}
	journey := []ssoevent.Reason{
		ssoevent.ReasonStateInvalid, ssoevent.ReasonStateMismatch, ssoevent.ReasonNoCode, ssoevent.ReasonConnectionBroken,
		ssoevent.ReasonSecretMissing, ssoevent.ReasonSubjectInvalid, ssoevent.ReasonCreationDisabled,
		ssoevent.ReasonClaimRejected, ssoevent.ReasonUnroutable, ssoevent.ReasonUserInvalid,
		ssoevent.ReasonOtherSchema, ssoevent.ReasonInternal,
	}
	for _, r := range provider {
		assert.Equal(t, ssoevent.SideProvider, r.Side(), r)
	}
	for _, r := range journey {
		assert.Equal(t, ssoevent.SideJourney, r.Side(), r)
	}
}
