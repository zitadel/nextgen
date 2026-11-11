package api

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// The operations that ask no gate, each in exactly one class
// (TestGateContractCoversEveryOperation). The runtime plane and self-service
// confine a caller by something other than a grant, so each has a test of
// that confinement; the other classes keep a reason only.

// runtimeRow is an operation of the runtime plane: a project secret acting on
// its own project's attempts and sessions, with no grant asked.
type runtimeRow struct {
	op string
	// carriesProject pins whether the request carries a project_id (in the
	// body or the params); one naming another project answers proj.mismatch.
	carriesProject bool
	// emptyAccepted pins whether an empty project_id passes, the credential's
	// project standing in for it.
	emptyAccepted bool
	// adjust fills what the zero request needs to get to the service.
	adjust func(*testing.T, opArgs)
	// serve wires the service the request reaches, recording the project it
	// is asked for into asked, when that is not the recording auth attempt
	// service.
	serve func(f *gateFixture, asked *[]string)
}

var runtimePlaneOperations = []runtimeRow{
	{op: "CreateAuthAttempt", carriesProject: true, emptyAccepted: true},
	{op: "GetAuthAttempt"},
	{op: "IssueChallenge", adjust: func(t *testing.T, a opArgs) {
		argOf[api.IssueChallengeRequest](t, a).Method = api.ChallengeMethodIdentifier
	}},
	{op: "VerifyChallengeProof", adjust: func(t *testing.T, a opArgs) {
		argOf[api.VerifyChallengeRequest](t, a).OneOf = api.NewIdentifierProofVerifyChallengeRequestSum(api.IdentifierProof{LoginName: "alice"})
	}},
	{op: "CreateHandoff"},
	{op: "CreateSession", carriesProject: true, serve: func(f *gateFixture, asked *[]string) {
		f.sessions.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, in service.CreateSessionInput) (*domain.Session, error) {
			*asked = append(*asked, in.ProjectID)
			return nil, errReachedService
		})
	}},
	// project_id is required in the spec, so the decoder refuses a request
	// without it; the handler alone would accept it empty.
	{op: "ExchangeHandoff", carriesProject: true, emptyAccepted: true, serve: func(f *gateFixture, asked *[]string) {
		f.sessions.EXPECT().Exchange(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, in service.ExchangeInput) (*domain.Session, error) {
			*asked = append(*asked, in.ProjectID)
			return nil, errReachedService
		})
	}},
}

// selfServiceOperations are the session cookie acting on itself or its own
// user (requireSelf), with no grant asked. Each takes project_id, and a
// session of another project is refused before anything is looked up.
//
// Open decision, without a test: after DeactivateUser, the user's session
// still answers 200 on GET and PATCH /users/me, GET /sessions/me and
// GET /users/me/passkeys, while GET /users/me/projects answers 401 and the
// management paths 404 (seen with a probe on SQLite). Whether self-service
// should end with the user is undecided.
var selfServiceOperations = []string{
	"GetMySession",
	"GetMySessionCsrfToken",
	"RevokeMySession",
	"GetMyUser",
	"PatchMyUser",
	"GetMyUserSchema",
	"GetMyPasswordState",
	"ListMyIdentityLinks",
	"ListMyPasskeys",
	"ListMyTeams",
	// Also asks the platform operator question, pinned with its exact params
	// by TestListMyProjects_PlatformOperator; a "no" still lists the caller's
	// own projects.
	"ListMyProjects",
}

// The classes that keep a reason only.
const (
	classPublic          = "public"
	classTokenCredential = "token credential"
	classNotImplemented  = "not implemented"
)

type reasonOnly struct{ class, reason string }

var reasonOnlyOperations = map[string]reasonOnly{
	"GetLive":        {classPublic, "health probe"},
	"GetReady":       {classPublic, "health probe"},
	"CreateFlow":     {classPublic, "the login flow engine a browser drives before anyone signs in"},
	"GetFlowStep":    {classPublic, "the login flow engine a browser drives before anyone signs in"},
	"SubmitFlowStep": {classPublic, "the login flow engine a browser drives before anyone signs in"},
	"CreateProject":  {classPublic, "anonymous bootstrap; the claim flow attaches an owner"},
	"GetClaimWindow": {classPublic, "tells a claim link's holder whether it expired"},

	"AcceptInvitation": {classTokenCredential, "the invitation token is the credential"},
	"LookupInvitation": {classTokenCredential, "the invitation token is the credential"},
	"RejectInvitation": {classTokenCredential, "the invitation token is the credential"},
	"CompleteClaim":    {classTokenCredential, "the claim challenge and the platform session are the credential (verifyClaimSession)"},

	"CreateApplication":  {classNotImplemented, "answers 501"},
	"GetApplicationById": {classNotImplemented, "answers 501"},
}

// ungatedClasses maps each ungated operation to the classes it is listed in.
func ungatedClasses() map[string][]string {
	classes := map[string][]string{}
	for _, row := range runtimePlaneOperations {
		classes[row.op] = append(classes[row.op], "runtime plane")
	}
	for _, op := range selfServiceOperations {
		classes[op] = append(classes[op], "self-service")
	}
	for op, entry := range reasonOnlyOperations {
		classes[op] = append(classes[op], entry.class)
	}
	return classes
}

// recordingAuthAttempts records the project each auth attempt method is asked
// for and stops the request there. Any other method panics.
type recordingAuthAttempts struct {
	service.AuthAttemptService
	projects []string
}

func (s *recordingAuthAttempts) Create(_ context.Context, in service.CreateAuthAttemptInput) (*domain.AuthAttempt, error) {
	s.projects = append(s.projects, in.ProjectID)
	return nil, errReachedService
}

func (s *recordingAuthAttempts) GetByID(_ context.Context, projectID, _ string) (*domain.AuthAttempt, error) {
	s.projects = append(s.projects, projectID)
	return nil, errReachedService
}

func (s *recordingAuthAttempts) IssueChallenge(_ context.Context, in service.IssueChallengeInput) (*domain.AuthAttempt, error) {
	s.projects = append(s.projects, in.ProjectID)
	return nil, errReachedService
}

func (s *recordingAuthAttempts) VerifyProof(_ context.Context, in service.VerifyProofInput) (*domain.AuthAttempt, error) {
	s.projects = append(s.projects, in.ProjectID)
	return nil, errReachedService
}

func (s *recordingAuthAttempts) Handoff(_ context.Context, in service.HandoffInput) (*domain.AuthAttempt, error) {
	s.projects = append(s.projects, in.ProjectID)
	return nil, errReachedService
}

// TestRuntimePlaneStaysInTheSecretsProject: a runtime operation acts on the
// calling secret's own project. A project_id naming another one answers
// proj.mismatch before any service is asked; otherwise the service is asked
// for the credential's project, whatever the request says.
func TestRuntimePlaneStaysInTheSecretsProject(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)
	mismatch := domain.ErrProjectMismatch().Code

	for _, row := range runtimePlaneOperations {
		spec, ok := ops[row.op]
		require.True(t, ok, "%s is not in the spec", row.op)
		assert.Equal(t, map[string]bool{"oauth2": true}, spec.schemes, "%s: the runtime plane takes a project secret only", row.op)

		type run struct {
			name, project string
			refused       bool
		}
		runs := []run{{name: "own project", project: contractHome}}
		if row.carriesProject {
			runs = append(runs,
				run{name: "another project", project: contractTarget, refused: true},
				run{name: "no project", project: "", refused: !row.emptyAccepted})
		}
		for _, r := range runs {
			t.Run(row.op+"/"+r.name, func(t *testing.T) {
				t.Parallel()
				f := newGateFixture(t, false)
				args := buildOpArgs(t, row.op, "", gateCall{project: r.project, id: contractPathID})
				require.Equal(t, row.carriesProject, args.namedProject, "%s: whether the request carries a project_id changed", row.op)
				if row.adjust != nil {
					row.adjust(t, args)
				}
				var asked []string
				if row.serve != nil && !r.refused {
					row.serve(f, &asked)
				}

				err := callOperation(t, f.handler, row.op, args, secretPrincipal.scope, nil)

				asked = append(slices.Clone(f.attempts.projects), asked...)
				assert.Empty(t, f.stmts.recordedChecks(), "the runtime plane asks no Check")
				if r.refused {
					assertDomainCode(t, err, mismatch)
					assert.Empty(t, asked, "a refused request reaches no service")
					return
				}
				assert.Equal(t, []string{contractHome}, asked, "the service is asked for the credential's project")
				assert.True(t, errors.Is(err, errReachedService), "the request stops at the service: %v", err)
			})
		}
	}
}

// TestSelfServiceHoldsTheSessionToItsProject: a self-service operation that
// names a project refuses a session of another one (requireSelf,
// holdSessionToProject) before it asks anything.
func TestSelfServiceHoldsTheSessionToItsProject(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)
	token := &domain.Token{
		Type:      domain.TokenTypeSessionToken,
		ProjectID: contractHome,
		UserID:    sessionPrincipal.scope.PrincipalID,
		SessionID: new("sess_1"),
		TokenID:   "tkn_1",
	}

	for _, op := range selfServiceOperations {
		spec, ok := ops[op]
		require.True(t, ok, "%s is not in the spec", op)
		assert.Equal(t, map[string]bool{"sessionCookie": true}, spec.schemes, "%s: self-service takes the session cookie only", op)

		t.Run(op, func(t *testing.T) {
			t.Parallel()
			f := newGateFixture(t, false)
			args := buildOpArgs(t, op, "", gateCall{project: contractTarget})
			require.True(t, args.namedProject, "%s takes no project_id: nothing holds its session to a project", op)

			err := callOperation(t, f.handler, op, args, sessionPrincipal.scope, token)

			assertDomainCode(t, err, domain.ErrSessionProjectMismatch().Code)
			assert.Empty(t, f.stmts.recordedChecks(), "self-service asks no Check")
			assert.Empty(t, f.stmts.operators, "a refused session is not asked the operator question")
			f.assertNoFakeReached(t)
		})
	}
}

// TestPublicOperationsAskForNoCredential: an operation classed public has no
// security requirement in the spec.
func TestPublicOperationsAskForNoCredential(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)
	for op, entry := range reasonOnlyOperations {
		if entry.class != classPublic {
			continue
		}
		spec, ok := ops[op]
		if !assert.True(t, ok, "%s is not in the spec", op) {
			continue
		}
		assert.Empty(t, spec.schemes, "%s %s is classed public but asks for a credential", spec.method, spec.path)
	}
}
