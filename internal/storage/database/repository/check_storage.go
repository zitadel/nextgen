package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	pgChecksTable      = "zitadel_nextgen.checks"
	spannerChecksTable = "checks"
)

type checksDialect struct {
	table string
	now   database.Instruction
}

func checksDialectFor(client database.QueryExecutor) checksDialect {
	if isSpannerPooler(client) {
		return checksDialect{table: spannerChecksTable, now: database.CurrentTimestampInstruction}
	}
	return checksDialect{table: pgChecksTable, now: database.NowInstruction}
}

func sessionChecksSelectBuilder(d checksDialect) *database.StatementBuilder {
	b := database.NewStatementBuilder("SELECT c.id, c.auth_attempt_id, c.type, c.user_password_id, c.user_totp_id, c.user_passkey_id, c.user_recovery_codes_id,")
	b.WriteString(" c.started_at, c.succeeded_at, c.failed_at, c.handedoff_at, c.failure_count, c.challenge, c.factor, c.supersedes FROM ")
	b.WriteString(d.table)
	b.WriteString(" c")
	return b
}

func attemptChecksSelectBuilder(d checksDialect) *database.StatementBuilder {
	b := database.NewStatementBuilder("SELECT c.id, c.auth_attempt_id, c.session_id, c.type, c.user_password_id, c.user_totp_id, c.user_passkey_id, c.user_recovery_codes_id,")
	b.WriteString(" c.started_at, c.succeeded_at, c.failed_at, c.handedoff_at, c.failure_count, c.challenge, c.factor, c.supersedes FROM ")
	b.WriteString(d.table)
	b.WriteString(" c")
	return b
}

func isSpannerPooler(client database.QueryExecutor) bool {
	type spannerPooler interface {
		isSpanner()
	}
	_, ok := client.(spannerPooler)
	return ok
}

func checkRowID(projectID, authAttemptID string, typ domain.AuthCheckType) string {
	return projectID + ":" + authAttemptID + ":" + typ.String()
}

func scanAuthChecker(
	projectID string,
	id string,
	authAttemptID, sessionID database.Null[string],
	typ domain.AuthCheckType,
	userPasswordID, userTotpID, userPasskeyID, userRecoveryCodesID database.Null[int64],
	startedAt, succeededAt, failedAt, handedOffAt database.Null[time.Time],
	failureCount database.Null[uint16],
	challenge, factor json.RawMessage,
	supersedes database.Null[string],
) (domain.AuthChecker, error) {
	check := &domain.AuthCheck{
		ProjectID: projectID,
		ID:        id,
		Type:      typ,
	}
	if authAttemptID.Valid {
		check.AuthAttemptID = &authAttemptID.V
	}
	if sessionID.Valid {
		check.SessionID = &sessionID.V
	}
	if userPasswordID.Valid {
		check.UserPasswordID = &userPasswordID.V
	}
	if userTotpID.Valid {
		check.UserTOTPID = &userTotpID.V
	}
	if userPasskeyID.Valid {
		check.UserPasskeyID = &userPasskeyID.V
	}
	if userRecoveryCodesID.Valid {
		check.UserRecoveryCodesID = &userRecoveryCodesID.V
	}
	if startedAt.Valid {
		check.LastChallengedAt = startedAt.V
	}
	if succeededAt.Valid {
		check.LastVerifiedAt = succeededAt.V
	}
	if failedAt.Valid {
		check.LastFailedAt = &failedAt.V
	}
	if handedOffAt.Valid {
		check.HandedOffAt = &handedOffAt.V
	}
	if failureCount.Valid {
		check.FailureCount = failureCount.V
	}
	if supersedes.Valid {
		check.Supersedes = &supersedes.V
	}
	return newAuthCheck(check, challenge, factor)
}

func checksToSessionFactors(checkers []domain.AuthChecker) []*domain.SessionFactor {
	factors := make([]*domain.SessionFactor, 0, len(checkers))
	for _, checker := range checkers {
		if checker == nil {
			continue
		}
		ac := checker.Check()
		if ac == nil || !ac.Succeeded() || ac.HandedOffAt == nil {
			continue
		}
		var factor any
		if f, ok := checker.(domain.AuthFactorer); ok {
			factor = f.FactorPayload()
		}
		factors = append(factors, &domain.SessionFactor{
			Type:       ac.Type,
			VerifiedAt: ac.LastVerifiedAt,
			Factor:     factor,
		})
	}
	return factors
}

func loadSessionChecks(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) ([]domain.AuthChecker, error) {
	d := checksDialectFor(client)
	b := sessionChecksSelectBuilder(d)
	b.WriteString(" WHERE c.project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND c.session_id = ")
	b.WriteArg(sessionID)
	b.WriteString(" AND c.handedoff_at IS NOT NULL AND c.succeeded_at IS NOT NULL")
	rows, err := client.Query(ctx, b.String(), b.Args()...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.AuthChecker
	for rows.Next() {
		checker, err := scanAuthCheckerRow(rows, projectID, database.Null[string]{Valid: true, V: sessionID})
		if err != nil {
			return nil, err
		}
		out = append(out, checker)
	}
	return out, rows.Err()
}

func scanAuthCheckerRow(rows database.Rows, projectID string, sessionID database.Null[string]) (domain.AuthChecker, error) {
	var (
		id                                                   string
		authAttemptID, supersedes                            database.Null[string]
		typ                                                  int16
		userPasswordID, userTotpID, userPasskeyID, userRecoveryCodesID database.Null[int64]
		startedAt, succeededAt, failedAt, handedOffAt        database.Null[time.Time]
		failureCount                                         database.Null[uint16]
		challenge, factor                                    json.RawMessage
	)
	if err := rows.Scan(
		&id, &authAttemptID, &typ, &userPasswordID, &userTotpID, &userPasskeyID, &userRecoveryCodesID,
		&startedAt, &succeededAt, &failedAt, &handedOffAt, &failureCount, &challenge, &factor, &supersedes,
	); err != nil {
		return nil, err
	}
	return scanAuthChecker(projectID, id, authAttemptID, sessionID, domain.AuthCheckType(typ),
		userPasswordID, userTotpID, userPasskeyID, userRecoveryCodesID,
		startedAt, succeededAt, failedAt, handedOffAt, failureCount, challenge, factor, supersedes)
}

func scanAttemptAuthCheckerRow(rows database.Rows, projectID string) (domain.AuthChecker, error) {
	var (
		id                                                   string
		authAttemptID, sessionID, supersedes                 database.Null[string]
		typ                                                  int16
		userPasswordID, userTotpID, userPasskeyID, userRecoveryCodesID database.Null[int64]
		startedAt, succeededAt, failedAt, handedOffAt        database.Null[time.Time]
		failureCount                                         database.Null[uint16]
		challenge, factor                                    json.RawMessage
	)
	if err := rows.Scan(
		&id, &authAttemptID, &sessionID, &typ,
		&userPasswordID, &userTotpID, &userPasskeyID, &userRecoveryCodesID,
		&startedAt, &succeededAt, &failedAt, &handedOffAt, &failureCount, &challenge, &factor, &supersedes,
	); err != nil {
		return nil, err
	}
	return scanAuthChecker(projectID, id, authAttemptID, sessionID, domain.AuthCheckType(typ),
		userPasswordID, userTotpID, userPasskeyID, userRecoveryCodesID,
		startedAt, succeededAt, failedAt, handedOffAt, failureCount, challenge, factor, supersedes)
}

type credentialFailureFlusher struct {
	passwords *UserPasswordRepository
	totp      *UserTOTPRepository
	recovery  *UserRecoveryCodesRepository
}

func (f *credentialFailureFlusher) flush(ctx context.Context, client database.QueryExecutor, checker domain.AuthChecker) error {
	if checker == nil {
		return nil
	}
	ac := checker.Check()
	if ac == nil {
		return nil
	}
	var changes []database.Change
	if ac.Succeeded() {
		switch {
		case ac.UserPasswordID != nil:
			changes = []database.Change{f.passwords.ResetFailedAttempts()}
		case ac.UserTOTPID != nil:
			changes = []database.Change{f.totp.ResetFailedAttempts()}
		case ac.UserRecoveryCodesID != nil:
			changes = []database.Change{f.recovery.ResetFailedAttempts()}
		default:
			return nil
		}
	} else if ac.FailureCount > 0 {
		switch {
		case ac.UserPasswordID != nil:
			changes = []database.Change{f.passwords.AddFailedAttempts(int16(ac.FailureCount))}
		case ac.UserTOTPID != nil:
			changes = []database.Change{f.totp.AddFailedAttempts(int16(ac.FailureCount))}
		case ac.UserRecoveryCodesID != nil:
			changes = []database.Change{f.recovery.AddFailedAttempts(int16(ac.FailureCount))}
		default:
			return nil
		}
	} else {
		return nil
	}

	cond := credentialCondition(ac)
	if cond == nil {
		return nil
	}
	_, err := updateCredential(ctx, client, ac, f, changes...)
	return err
}

func credentialCondition(ac *domain.AuthCheck) database.Condition {
	if ac == nil {
		return nil
	}
	switch {
	case ac.UserPasswordID != nil:
		return NewUserPasswordRepository().PrimaryKeyCondition(*ac.UserPasswordID)
	case ac.UserTOTPID != nil:
		return NewUserTOTPRepository().PrimaryKeyCondition(*ac.UserTOTPID)
	case ac.UserRecoveryCodesID != nil:
		return NewUserRecoveryCodesRepository().PrimaryKeyCondition(*ac.UserRecoveryCodesID)
	default:
		return nil
	}
}

func updateCredential(ctx context.Context, client database.QueryExecutor, ac *domain.AuthCheck, f *credentialFailureFlusher, changes ...database.Change) (int64, error) {
	switch {
	case ac.UserPasswordID != nil:
		return updateOne(ctx, client, f.passwords, f.passwords.PrimaryKeyCondition(*ac.UserPasswordID), changes...)
	case ac.UserTOTPID != nil:
		return updateOne(ctx, client, f.totp, f.totp.PrimaryKeyCondition(*ac.UserTOTPID), changes...)
	case ac.UserRecoveryCodesID != nil:
		return updateOne(ctx, client, f.recovery, f.recovery.PrimaryKeyCondition(*ac.UserRecoveryCodesID), changes...)
	default:
		return 0, nil
	}
}

func deleteSessionChecksForCredential(ctx context.Context, client database.QueryExecutor, projectID, sessionID string, checker domain.AuthChecker) error {
	ac := checker.Check()
	if ac == nil {
		return nil
	}
	d := checksDialectFor(client)
	var col string
	var id int64
	switch {
	case ac.UserPasswordID != nil:
		col, id = "user_password_id", *ac.UserPasswordID
	case ac.UserTOTPID != nil:
		col, id = "user_totp_id", *ac.UserTOTPID
	case ac.UserPasskeyID != nil:
		col, id = "user_passkey_id", *ac.UserPasskeyID
	case ac.UserRecoveryCodesID != nil:
		col, id = "user_recovery_codes_id", *ac.UserRecoveryCodesID
	default:
		return nil
	}
	b := database.NewStatementBuilder("DELETE FROM ")
	b.WriteString(d.table)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND session_id = ")
	b.WriteArg(sessionID)
	b.WriteString(" AND ")
	b.WriteString(col)
	b.WriteString(" = ")
	b.WriteArg(id)
	b.WriteString(" AND handedoff_at IS NOT NULL")
	_, err := client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func promoteCheckToSession(ctx context.Context, client database.QueryExecutor, projectID, sessionID string, checker domain.AuthChecker) error {
	ac := checker.Check()
	if ac == nil {
		return nil
	}
	d := checksDialectFor(client)
	b := database.NewStatementBuilder("UPDATE ")
	b.WriteString(d.table)
	b.WriteString(" SET session_id = ")
	b.WriteArg(sessionID)
	b.WriteString(", handedoff_at = ")
	b.WriteArg(d.now)
	b.WriteString(", auth_attempt_id = NULL WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND id = ")
	b.WriteArg(ac.ID)
	_, err := client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func listAttemptChecks(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) ([]domain.AuthChecker, error) {
	d := checksDialectFor(client)
	b := attemptChecksSelectBuilder(d)
	b.WriteString(" WHERE c.project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND c.auth_attempt_id = ")
	b.WriteArg(authAttemptID)
	rows, err := client.Query(ctx, b.String(), b.Args()...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.AuthChecker
	for rows.Next() {
		checker, err := scanAttemptAuthCheckerRow(rows, projectID)
		if err != nil {
			return nil, err
		}
		out = append(out, checker)
	}
	return out, rows.Err()
}
