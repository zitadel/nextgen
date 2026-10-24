package harness

import (
	"fmt"
	"slices"
	"testing"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
)

// TestErrorCodesDecode holds the code vocabulary to the generated client: a
// code listed for an operation must be one its error-response sum type
// decodes, and the documented statuses' aliases must be listed too.
func TestErrorCodesDecode(t *testing.T) {
	decoders := map[string]func(code string) error{
		OpCreateFlow: func(code string) error {
			return new(api.CreateFlowErrorResponse).Decode(jx.DecodeStr(fmt.Sprintf(`{"code":%q,"message":"m"}`, code)))
		},
		OpSubmitIdent: func(code string) error {
			return new(api.SubmitFlowStepErrorResponse).Decode(jx.DecodeStr(fmt.Sprintf(`{"code":%q,"message":"m"}`, code)))
		},
		OpGetUser: func(code string) error {
			return new(api.GetUserByIDErrorResponse).Decode(jx.DecodeStr(fmt.Sprintf(`{"code":%q,"message":"m"}`, code)))
		},
	}
	decoders[OpSubmitPassword] = decoders[OpSubmitIdent]
	for _, op := range Operations {
		codes := ErrorCodes(op)
		for _, hc := range harnessCodes {
			if !slices.Contains(codes, hc) {
				t.Errorf("%s: harness code %s missing", op, hc)
			}
		}
		for _, code := range codes {
			if slices.Contains(harnessCodes, code) {
				continue
			}
			if err := decoders[op](code); err != nil {
				t.Errorf("%s: code %q is not one the generated client decodes: %v", op, code, err)
			}
		}
		if decoders[op]("no.such_code") == nil {
			t.Errorf("%s: decoder accepts an unknown code; the test proves nothing", op)
		}
	}
	for _, want := range []string{"user.not_found", "auth.unauthorized"} {
		if !slices.Contains(ErrorCodes(OpGetUser), want) {
			t.Errorf("get_user vocabulary lacks %s", want)
		}
	}
}

func TestSubmetricsCoverTheVocabulary(t *testing.T) {
	subs := Submetrics()
	for _, want := range []string{
		"http_req_duration{op:get_user}",
		"nextgen_errors{op:get_user}",
		"nextgen_errors{op:get_user,status_class:4xx}",
		"nextgen_errors{op:get_user,code:user.not_found}",
		"nextgen_errors{op:create_flow,code:transport}",
		"nextgen_errors{op:submit_password,code:flow.step_error}",
	} {
		if !slices.Contains(subs, want) {
			t.Errorf("submetrics lack %s", want)
		}
	}
	if len(subs) != len(slices.Compact(slices.Sorted(slices.Values(subs)))) {
		t.Error("submetrics contain duplicates")
	}
}
