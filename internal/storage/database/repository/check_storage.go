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

func scanCheckIntoAuthChecker(
	id string,
	typ domain.AuthCheckType,
	startedAt, succeededAt database.Null[time.Time],
	failedAt database.Null[time.Time],
	failureCount database.Null[uint16],
	challenge, factor json.RawMessage,
) (domain.AuthChecker, error) {
	check := domain.AuthCheck{ID: id, Type: typ}
	if startedAt.Valid {
		check.LastChallengedAt = startedAt.V
	}
	if succeededAt.Valid {
		check.LastVerifiedAt = succeededAt.V
	}
	if failedAt.Valid {
		check.LastFailedAt = &failedAt.V
	}
	if failureCount.Valid {
		check.FailureCount = failureCount.V
	}
	return newAuthCheck(&check, challenge, factor)
}

func scanDomainCheck(
	projectID string,
	id string,
	authAttemptID, sessionID database.Null[string],
	typ domain.AuthCheckType,
	userPasswordID, userTotpID, userPasskeyID, userRecoveryCodesID database.Null[int64],
	startedAt, succeededAt database.Null[time.Time],
	failedAt, handedOffAt database.Null[time.Time],
	failureCount database.Null[uint16],
	challenge, factor json.RawMessage,
	supersedes database.Null[string],
) *domain.Check {
	c := &domain.Check{
		ProjectID: projectID,
		ID:        id,
		Type:      typ,
	}
	if authAttemptID.Valid {
		c.AuthAttemptID = &authAttemptID.V
	}
	if sessionID.Valid {
		c.SessionID = &sessionID.V
	}
	if userPasswordID.Valid {
		c.UserPasswordID = &userPasswordID.V
	}
	if userTotpID.Valid {
		c.UserTOTPID = &userTotpID.V
	}
	if userPasskeyID.Valid {
		c.UserPasskeyID = &userPasskeyID.V
	}
	if userRecoveryCodesID.Valid {
		c.UserRecoveryCodesID = &userRecoveryCodesID.V
	}
	if startedAt.Valid {
		c.StartedAt = startedAt.V
	}
	if succeededAt.Valid {
		c.SucceededAt = succeededAt.V
	}
	if failedAt.Valid {
		c.FailedAt = &failedAt.V
	}
	if handedOffAt.Valid {
		c.HandedOffAt = &handedOffAt.V
	}
	if failureCount.Valid {
		c.FailureCount = failureCount.V
	}
	if len(challenge) > 0 && string(challenge) != "null" {
		_ = json.Unmarshal(challenge, &c.Challenge)
	}
	if len(factor) > 0 && string(factor) != "null" {
		_ = json.Unmarshal(factor, &c.Factor)
	}
	if supersedes.Valid {
		c.Supersedes = &supersedes.V
	}
	return c
}

func checksToSessionFactors(checks []*domain.Check) []*domain.SessionFactor {
	factors := make([]*domain.SessionFactor, 0, len(checks))
	for _, c := range checks {
		if c == nil || !c.Succeeded() || c.HandedOffAt == nil {
			continue
		}
		factors = append(factors, &domain.SessionFactor{
			Type:       c.Type,
			VerifiedAt: c.SucceededAt,
			Factor:     c.Factor,
		})
	}
	return factors
}

func loadSessionChecks(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) ([]*domain.Check, error) {
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

	var out []*domain.Check
	for rows.Next() {
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
		c := scanDomainCheck(projectID, id, authAttemptID, database.Null[string]{Valid: true, V: sessionID},
			domain.AuthCheckType(typ), userPasswordID, userTotpID, userPasskeyID, userRecoveryCodesID,
			startedAt, succeededAt, failedAt, handedOffAt, failureCount, challenge, factor, supersedes)
		out = append(out, c)
	}
	return out, rows.Err()
}

type credentialFailureFlusher struct {
	passwords *UserPasswordRepository
	totp      *UserTOTPRepository
	recovery  *UserRecoveryCodesRepository
}

func (f *credentialFailureFlusher) flush(ctx context.Context, client database.QueryExecutor, c *domain.Check) error {
	if c == nil {
		return nil
	}
	var changes []database.Change
	if c.Succeeded() {
		switch {
		case c.UserPasswordID != nil:
			changes = []database.Change{f.passwords.ResetFailedAttempts()}
		case c.UserTOTPID != nil:
			changes = []database.Change{f.totp.ResetFailedAttempts()}
		case c.UserRecoveryCodesID != nil:
			changes = []database.Change{f.recovery.ResetFailedAttempts()}
		default:
			return nil
		}
	} else if c.FailureCount > 0 {
		switch {
		case c.UserPasswordID != nil:
			changes = []database.Change{f.passwords.AddFailedAttempts(int16(c.FailureCount))}
		case c.UserTOTPID != nil:
			changes = []database.Change{f.totp.AddFailedAttempts(int16(c.FailureCount))}
		case c.UserRecoveryCodesID != nil:
			changes = []database.Change{f.recovery.AddFailedAttempts(int16(c.FailureCount))}
		default:
			return nil
		}
	} else {
		return nil
	}

	cond := credentialCondition(c)
	if cond == nil {
		return nil
	}
	_, err := updateCredential(ctx, client, c, f, changes...)
	return err
}

func credentialCondition(c *domain.Check) database.Condition {
	switch {
	case c.UserPasswordID != nil:
		return NewUserPasswordRepository().PrimaryKeyCondition(*c.UserPasswordID)
	case c.UserTOTPID != nil:
		return NewUserTOTPRepository().PrimaryKeyCondition(*c.UserTOTPID)
	case c.UserRecoveryCodesID != nil:
		return NewUserRecoveryCodesRepository().PrimaryKeyCondition(*c.UserRecoveryCodesID)
	default:
		return nil
	}
}

func updateCredential(ctx context.Context, client database.QueryExecutor, c *domain.Check, f *credentialFailureFlusher, changes ...database.Change) (int64, error) {
	switch {
	case c.UserPasswordID != nil:
		return updateOne(ctx, client, f.passwords, f.passwords.PrimaryKeyCondition(*c.UserPasswordID), changes...)
	case c.UserTOTPID != nil:
		return updateOne(ctx, client, f.totp, f.totp.PrimaryKeyCondition(*c.UserTOTPID), changes...)
	case c.UserRecoveryCodesID != nil:
		return updateOne(ctx, client, f.recovery, f.recovery.PrimaryKeyCondition(*c.UserRecoveryCodesID), changes...)
	default:
		return 0, nil
	}
}

func deleteSessionChecksForCredential(ctx context.Context, client database.QueryExecutor, projectID, sessionID string, c *domain.Check) error {
	d := checksDialectFor(client)
	var col string
	var id int64
	switch {
	case c.UserPasswordID != nil:
		col, id = "user_password_id", *c.UserPasswordID
	case c.UserTOTPID != nil:
		col, id = "user_totp_id", *c.UserTOTPID
	case c.UserPasskeyID != nil:
		col, id = "user_passkey_id", *c.UserPasskeyID
	case c.UserRecoveryCodesID != nil:
		col, id = "user_recovery_codes_id", *c.UserRecoveryCodesID
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

func promoteCheckToSession(ctx context.Context, client database.QueryExecutor, projectID, sessionID string, c *domain.Check) error {
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
	b.WriteArg(c.ID)
	_, err := client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func listAttemptChecks(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) ([]*domain.Check, error) {
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
	var out []*domain.Check
	for rows.Next() {
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
		out = append(out, scanDomainCheck(projectID, id, authAttemptID, sessionID, domain.AuthCheckType(typ),
			userPasswordID, userTotpID, userPasskeyID, userRecoveryCodesID,
			startedAt, succeededAt, failedAt, handedOffAt, failureCount, challenge, factor, supersedes))
	}
	return out, rows.Err()
}
