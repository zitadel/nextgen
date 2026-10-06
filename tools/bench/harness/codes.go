package harness

import api "github.com/zitadel/nextgen/api/generated"

// StatusClasses is the status_class tag vocabulary: see OpError.StatusClass.
var StatusClasses = []string{"0", "2xx", "4xx", "5xx"}

// harnessCodes are the codes the harness assigns itself, for failures that
// carry no error-details body.
var harnessCodes = []string{CodeStepError, CodeUnexpectedResponse, CodeTransport}

// ErrorCodes is the code tag vocabulary of an operation: the error codes the
// generated client decodes for it — the variants of its error-response sum
// type, with the documented statuses' aliases among them — plus the
// harness's own. The lists mirror the generated types; TestErrorCodesDecode
// holds them to the generated decoder.
func ErrorCodes(op string) []string {
	var codes []string
	switch op {
	case OpCreateFlow:
		codes = createFlowCodes
	case OpSubmitIdent, OpSubmitPassword:
		codes = submitFlowStepCodes
	case OpGetUser:
		codes = getUserCodes
	case OpGetMySession:
		codes = getMySessionCodes
	}
	return append(append([]string(nil), codes...), harnessCodes...)
}

var createFlowCodes = []string{
	string(api.AttInvalidRequestCreateFlowErrorResponse),
	string(api.EncKeyDecryptFailedCreateFlowErrorResponse),
	string(api.EncKeyEncryptFailedCreateFlowErrorResponse),
	string(api.EncKeyNotFoundCreateFlowErrorResponse),
	string(api.EncKeyUnknownAlgCreateFlowErrorResponse),
	string(api.EvtInvalidCreateFlowErrorResponse),
	string(api.FlowdefNotFoundCreateFlowErrorResponse),
	string(api.FlowdefPurposeMismatchCreateFlowErrorResponse),
	string(api.FlowIntegrityCreateFlowErrorResponse),
	string(api.FlowInvalidPurposeCreateFlowErrorResponse),
	string(api.InternalCreateFlowErrorResponse),
	string(api.ReqInvalidCreateFlowErrorResponse),
	string(api.TknInvalidCreateFlowErrorResponse),
	string(api.TknInvalidTknidCreateFlowErrorResponse),
}

var submitFlowStepCodes = []string{
	string(api.AttAlreadyHandedOffSubmitFlowStepErrorResponse),
	string(api.AttInvalidRequestSubmitFlowStepErrorResponse),
	string(api.AttInvalidStateSubmitFlowStepErrorResponse),
	string(api.AttNotCompletedSubmitFlowStepErrorResponse),
	string(api.AttNotFoundSubmitFlowStepErrorResponse),
	string(api.AttProofRejectedSubmitFlowStepErrorResponse),
	string(api.AttStaleChallengeSubmitFlowStepErrorResponse),
	string(api.EncKeyDecryptFailedSubmitFlowStepErrorResponse),
	string(api.EncKeyEncryptFailedSubmitFlowStepErrorResponse),
	string(api.EncKeyNotFoundSubmitFlowStepErrorResponse),
	string(api.EncKeyUnknownAlgSubmitFlowStepErrorResponse),
	string(api.EvtInvalidSubmitFlowStepErrorResponse),
	string(api.FlowCookieExpiredSubmitFlowStepErrorResponse),
	string(api.FlowCookieInvalidSubmitFlowStepErrorResponse),
	string(api.FlowIntegritySubmitFlowStepErrorResponse),
	string(api.FlowInvalidActionSubmitFlowStepErrorResponse),
	string(api.FlowNotFoundSubmitFlowStepErrorResponse),
	string(api.FlowUnsupportedSubmitFlowStepErrorResponse),
	string(api.InternalSubmitFlowStepErrorResponse),
	string(api.NotImplementedSubmitFlowStepErrorResponse),
	string(api.ReqInvalidSubmitFlowStepErrorResponse),
	string(api.TknInvalidSubmitFlowStepErrorResponse),
	string(api.UnavailableSubmitFlowStepErrorResponse),
	string(api.UserAlreadyExistsSubmitFlowStepErrorResponse),
	string(api.UserInvalidSubmitFlowStepErrorResponse),
	string(api.UserNotFoundSubmitFlowStepErrorResponse),
}

var getMySessionCodes = []string{
	string(api.AuthUnauthorizedGetMySessionErrorResponse),
	string(api.InternalGetMySessionErrorResponse),
	string(api.ReqInvalidGetMySessionErrorResponse),
	string(api.SessNotFoundGetMySessionErrorResponse),
}

var getUserCodes = []string{
	string(api.AuthUnauthorizedGetUserByIDErrorResponse),
	string(api.InternalGetUserByIDErrorResponse),
	string(api.ReqInvalidGetUserByIDErrorResponse),
	string(api.UserNotFoundGetUserByIDErrorResponse),
	string(api.UserPermissionDeniedGetUserByIDErrorResponse),
}
