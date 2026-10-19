package ssoevent_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/instrumentation/ssoevent"
)

func TestReason_Side(t *testing.T) {
	t.Parallel()
	provider := []ssoevent.Reason{
		ssoevent.ReasonProviderDenied, ssoevent.ReasonProviderError, ssoevent.ReasonDiscoveryFailed,
		ssoevent.ReasonExchangeFailed, ssoevent.ReasonIDTokenInvalid, ssoevent.ReasonUserinfoFailed,
	}
	journey := []ssoevent.Reason{
		ssoevent.ReasonStateMismatch, ssoevent.ReasonNoCode, ssoevent.ReasonConnectionBroken,
		ssoevent.ReasonSecretMissing, ssoevent.ReasonSubjectInvalid, ssoevent.ReasonCreationDisabled,
		ssoevent.ReasonClaimRejected, ssoevent.ReasonUnroutable, ssoevent.ReasonUserInvalid,
		ssoevent.ReasonOtherSchema, ssoevent.ReasonHandoffFailed, ssoevent.ReasonInternal,
	}
	for _, reason := range provider {
		assert.Equal(t, ssoevent.SideProvider, reason.Side(), reason)
	}
	for _, reason := range journey {
		assert.Equal(t, ssoevent.SideJourney, reason.Side(), reason)
	}
}
