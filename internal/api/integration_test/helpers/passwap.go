//go:build integration

package helpers

import (
	"testing"

	"github.com/zitadel/passwap"
	"github.com/zitadel/passwap/bcrypt"
)

func (h *Harness) EnsurePasswap(t *testing.T) *passwap.Swapper {
	t.Helper()
	if h.Passwapper == nil {
		h.Passwapper = passwap.NewSwapper(bcrypt.New(bcrypt.DefaultMinCost, nil))
	}
	return h.Passwapper
}
