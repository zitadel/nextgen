package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	pgChecksTable      = "zitadel_nextgen.checks"
	spannerChecksTable = "checks"
)

type checksDialect struct {
	table         string
	now           database.Instruction
	userPasswords string
	userTotp      string
	userPasskeys  string
	userRecovery  string
}

func checksDialectFor(client database.QueryExecutor) checksDialect {
	if isSpannerPooler(client) {
		return checksDialect{
			table:         spannerChecksTable,
			now:           database.CurrentTimestampInstruction,
			userPasswords: "user_passwords",
			userTotp:      "user_totp",
			userPasskeys:  "user_passkeys",
			userRecovery:  "user_recovery_codes",
		}
	}
	return checksDialect{
		table:         pgChecksTable,
		now:           database.NowInstruction,
		userPasswords: userPasswordTable,
		userTotp:      userTotpTable,
		userPasskeys:  userPasskeyTable,
		userRecovery:  userRecoveryTable,
	}
}

func writeCheckCredentialSelect(b *database.StatementBuilder) {
	b.WriteString(", pw.id, pw.project_id, pw.user_id, pw.encoded_hash, pw.change_required, pw.changed_at, pw.verification_id, pw.last_successful_check, pw.failed_attempts, pw.created_at, pw.updated_at")
	b.WriteString(", totp.id, totp.project_id, totp.user_id, totp.secret, totp.verified_at, totp.last_successful_check, totp.failed_attempts, totp.created_at, totp.updated_at")
	b.WriteString(", pk.id, pk.project_id, pk.user_id, pk.credential_id, pk.public_key, pk.aaguid, pk.attestation_type, pk.transports, pk.sign_count, pk.backup_eligible, pk.backup_state, pk.name, pk.verified_at, pk.last_used_at, pk.created_at, pk.updated_at")
	b.WriteString(", rc.id, rc.project_id, rc.user_id, rc.recovery_codes, rc.last_successful_check, rc.failed_attempts, rc.created_at, rc.updated_at")
}

func writeCheckCredentialJoins(b *database.StatementBuilder, d checksDialect) {
	b.WriteString(" LEFT JOIN ")
	b.WriteString(d.userPasswords)
	b.WriteString(" pw ON c.user_password_id = pw.id LEFT JOIN ")
	b.WriteString(d.userTotp)
	b.WriteString(" totp ON c.user_totp_id = totp.id LEFT JOIN ")
	b.WriteString(d.userPasskeys)
	b.WriteString(" pk ON c.user_passkey_id = pk.id LEFT JOIN ")
	b.WriteString(d.userRecovery)
	b.WriteString(" rc ON c.user_recovery_codes_id = rc.id")
}

func sessionChecksSelectBuilder(d checksDialect) *database.StatementBuilder {
	b := database.NewStatementBuilder("SELECT c.id, c.auth_attempt_id, c.type, c.user_password_id, c.user_totp_id, c.user_passkey_id, c.user_recovery_codes_id,")
	b.WriteString(" c.started_at, c.succeeded_at, c.failed_at, c.handedoff_at, c.failure_count, c.challenge, c.factor, c.supersedes")
	writeCheckCredentialSelect(b)
	b.WriteString(" FROM ")
	b.WriteString(d.table)
	b.WriteString(" c")
	writeCheckCredentialJoins(b, d)
	return b
}

func attemptChecksSelectBuilder(d checksDialect) *database.StatementBuilder {
	b := database.NewStatementBuilder("SELECT c.id, c.auth_attempt_id, c.session_id, c.type, c.user_password_id, c.user_totp_id, c.user_passkey_id, c.user_recovery_codes_id,")
	b.WriteString(" c.started_at, c.succeeded_at, c.failed_at, c.handedoff_at, c.failure_count, c.challenge, c.factor, c.supersedes")
	writeCheckCredentialSelect(b)
	b.WriteString(" FROM ")
	b.WriteString(d.table)
	b.WriteString(" c")
	writeCheckCredentialJoins(b, d)
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

type joinedUserPasswordRow struct {
	ID                  database.Null[int64]
	ProjectID           database.Null[string]
	UserID              database.Null[string]
	EncodedHash         database.Null[string]
	ChangeRequired      database.Null[bool]
	ChangedAt           database.Null[time.Time]
	VerificationID      database.Null[string]
	LastSuccessfulCheck database.Null[time.Time]
	FailedAttempts      database.Null[int16]
	CreatedAt           database.Null[time.Time]
	UpdatedAt           database.Null[time.Time]
}

func (row joinedUserPasswordRow) toDomain() *domain.UserPassword {
	if !row.ID.Valid {
		return nil
	}
	up := &domain.UserPassword{
		ID:             row.ID.V,
		ProjectID:      row.ProjectID.V,
		UserID:         row.UserID.V,
		EncodedHash:    row.EncodedHash.V,
		ChangeRequired: row.ChangeRequired.V,
		ChangedAt:      row.ChangedAt.V,
		FailedAttempts: row.FailedAttempts.V,
		CreatedAt:      row.CreatedAt.V,
		UpdatedAt:      row.UpdatedAt.V,
	}
	if row.VerificationID.Valid {
		up.VerificationID = &row.VerificationID.V
	}
	if row.LastSuccessfulCheck.Valid {
		ts := row.LastSuccessfulCheck.V
		up.LastSuccessfulCheck = &ts
	}
	return up
}

type joinedUserTOTPRow struct {
	ID                  database.Null[int64]
	ProjectID           database.Null[string]
	UserID              database.Null[string]
	Secret              []byte
	VerifiedAt          database.Null[time.Time]
	LastSuccessfulCheck database.Null[time.Time]
	FailedAttempts      database.Null[int16]
	CreatedAt           database.Null[time.Time]
	UpdatedAt           database.Null[time.Time]
}

func (row joinedUserTOTPRow) toDomain() *domain.UserTOTP {
	if !row.ID.Valid {
		return nil
	}
	t := &domain.UserTOTP{
		ID:             row.ID.V,
		ProjectID:      row.ProjectID.V,
		UserID:         row.UserID.V,
		Secret:         append([]byte(nil), row.Secret...),
		FailedAttempts: row.FailedAttempts.V,
		CreatedAt:      row.CreatedAt.V,
		UpdatedAt:      row.UpdatedAt.V,
	}
	if row.VerifiedAt.Valid {
		t.VerifiedAt = row.VerifiedAt.V
	}
	if row.LastSuccessfulCheck.Valid {
		v := row.LastSuccessfulCheck.V
		t.LastSuccessfulCheck = &v
	}
	return t
}

type joinedUserPasskeyRow struct {
	ID              database.Null[int64]
	ProjectID       database.Null[string]
	UserID          database.Null[string]
	CredentialID    database.Null[string]
	PublicKey       []byte
	AAGUID          []byte
	AttestationType database.Null[string]
	Transports      []string
	SignCount       database.Null[int64]
	BackupEligible  database.Null[bool]
	BackupState     database.Null[bool]
	Name            database.Null[string]
	VerifiedAt      database.Null[time.Time]
	LastUsedAt      database.Null[time.Time]
	CreatedAt       database.Null[time.Time]
	UpdatedAt       database.Null[time.Time]
}

func (row joinedUserPasskeyRow) toDomain() *domain.UserPasskey {
	if !row.ID.Valid {
		return nil
	}
	p := &domain.UserPasskey{
		ID:             row.ID.V,
		ProjectID:      row.ProjectID.V,
		UserID:         row.UserID.V,
		CredentialID:   row.CredentialID.V,
		PublicKey:      append([]byte(nil), row.PublicKey...),
		AAGUID:         append([]byte(nil), row.AAGUID...),
		Transports:     append([]string(nil), row.Transports...),
		SignCount:      row.SignCount.V,
		BackupEligible: row.BackupEligible.V,
		BackupState:    row.BackupState.V,
	}
	if row.AttestationType.Valid {
		p.AttestationType = &row.AttestationType.V
	}
	if row.Name.Valid {
		p.Name = row.Name.V
	}
	if row.VerifiedAt.Valid {
		ts := row.VerifiedAt.V
		p.VerifiedAt = &ts
	}
	if row.LastUsedAt.Valid {
		ts := row.LastUsedAt.V
		p.LastUsedAt = &ts
	}
	if row.CreatedAt.Valid {
		cr := row.CreatedAt.V
		p.CreatedAt = &cr
	}
	if row.UpdatedAt.Valid {
		up := row.UpdatedAt.V
		p.UpdatedAt = &up
	}
	return p
}

type joinedUserRecoveryRow struct {
	ID                  database.Null[int64]
	ProjectID           database.Null[string]
	UserID              database.Null[string]
	RecoveryCodes       []string
	LastSuccessfulCheck database.Null[time.Time]
	FailedAttempts      database.Null[int16]
	CreatedAt           database.Null[time.Time]
	UpdatedAt           database.Null[time.Time]
}

func (row joinedUserRecoveryRow) toDomain() *domain.UserRecoveryCodes {
	if !row.ID.Valid {
		return nil
	}
	o := &domain.UserRecoveryCodes{
		ID:             row.ID.V,
		ProjectID:      row.ProjectID.V,
		UserID:         row.UserID.V,
		RecoveryCodes:  append([]string(nil), row.RecoveryCodes...),
		FailedAttempts: row.FailedAttempts.V,
		CreatedAt:      row.CreatedAt.V,
		UpdatedAt:      row.UpdatedAt.V,
	}
	if row.LastSuccessfulCheck.Valid {
		ts := row.LastSuccessfulCheck.V
		o.LastSuccessfulCheck = &ts
	}
	return o
}

type joinedCredentialScan struct {
	userPasswordFK      database.Null[int64]
	userTotpFK          database.Null[int64]
	userPasskeyFK       database.Null[int64]
	userRecoveryCodesFK database.Null[int64]
	pw                  joinedUserPasswordRow
	totp                joinedUserTOTPRow
	pk                  joinedUserPasskeyRow
	rc                  joinedUserRecoveryRow
}

func (s *joinedCredentialScan) scanTargets() []any {
	return []any{
		&s.pw.ID, &s.pw.ProjectID, &s.pw.UserID, &s.pw.EncodedHash, &s.pw.ChangeRequired, &s.pw.ChangedAt,
		&s.pw.VerificationID, &s.pw.LastSuccessfulCheck, &s.pw.FailedAttempts, &s.pw.CreatedAt, &s.pw.UpdatedAt,
		&s.totp.ID, &s.totp.ProjectID, &s.totp.UserID, &s.totp.Secret, &s.totp.VerifiedAt,
		&s.totp.LastSuccessfulCheck, &s.totp.FailedAttempts, &s.totp.CreatedAt, &s.totp.UpdatedAt,
		&s.pk.ID, &s.pk.ProjectID, &s.pk.UserID, &s.pk.CredentialID, &s.pk.PublicKey, &s.pk.AAGUID,
		&s.pk.AttestationType, &s.pk.Transports, &s.pk.SignCount, &s.pk.BackupEligible, &s.pk.BackupState,
		&s.pk.Name, &s.pk.VerifiedAt, &s.pk.LastUsedAt, &s.pk.CreatedAt, &s.pk.UpdatedAt,
		&s.rc.ID, &s.rc.ProjectID, &s.rc.UserID, &s.rc.RecoveryCodes, &s.rc.LastSuccessfulCheck,
		&s.rc.FailedAttempts, &s.rc.CreatedAt, &s.rc.UpdatedAt,
	}
}

func (s *joinedCredentialScan) applyToCheck(check *domain.AuthCheck) error {
	if s.userPasswordFK.Valid {
		if s.pw.ID.Valid {
			check.UserPassword = s.pw.toDomain()
		} else {
			return fmt.Errorf("check %s references missing user_password id %d", check.ID, s.userPasswordFK.V)
		}
	}
	if s.userTotpFK.Valid {
		if s.totp.ID.Valid {
			check.UserTOTP = s.totp.toDomain()
		} else {
			return fmt.Errorf("check %s references missing user_totp id %d", check.ID, s.userTotpFK.V)
		}
	}
	if s.userPasskeyFK.Valid {
		if s.pk.ID.Valid {
			check.UserPasskey = s.pk.toDomain()
		} else {
			return fmt.Errorf("check %s references missing user_passkey id %d", check.ID, s.userPasskeyFK.V)
		}
	}
	if s.userRecoveryCodesFK.Valid {
		if s.rc.ID.Valid {
			check.UserRecoveryCodes = s.rc.toDomain()
		} else {
			return fmt.Errorf("check %s references missing user_recovery_codes id %d", check.ID, s.userRecoveryCodesFK.V)
		}
	}
	return nil
}

func scanAuthChecker(
	projectID string,
	id string,
	authAttemptID, sessionID database.Null[string],
	typ domain.AuthCheckType,
	startedAt, succeededAt, failedAt, handedOffAt database.Null[time.Time],
	failureCount database.Null[uint16],
	challenge, factor json.RawMessage,
	supersedes database.Null[string],
	joined joinedCredentialScan,
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
	if err := joined.applyToCheck(check); err != nil {
		return nil, err
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
		id                                            string
		authAttemptID, supersedes                     database.Null[string]
		typ                                           int16
		startedAt, succeededAt, failedAt, handedOffAt   database.Null[time.Time]
		failureCount                                  database.Null[uint16]
		challenge, factor                             json.RawMessage
		joined                                        joinedCredentialScan
	)
	targets := []any{
		&id, &authAttemptID, &typ,
		&joined.userPasswordFK, &joined.userTotpFK, &joined.userPasskeyFK, &joined.userRecoveryCodesFK,
		&startedAt, &succeededAt, &failedAt, &handedOffAt, &failureCount, &challenge, &factor, &supersedes,
	}
	targets = append(targets, joined.scanTargets()...)
	if err := rows.Scan(targets...); err != nil {
		return nil, err
	}
	return scanAuthChecker(projectID, id, authAttemptID, sessionID, domain.AuthCheckType(typ),
		startedAt, succeededAt, failedAt, handedOffAt, failureCount, challenge, factor, supersedes, joined)
}

func scanAttemptAuthCheckerRow(rows database.Rows, projectID string) (domain.AuthChecker, error) {
	var (
		id                                            string
		authAttemptID, sessionID, supersedes          database.Null[string]
		typ                                           int16
		startedAt, succeededAt, failedAt, handedOffAt database.Null[time.Time]
		failureCount                                  database.Null[uint16]
		challenge, factor                             json.RawMessage
		joined                                        joinedCredentialScan
	)
	targets := []any{
		&id, &authAttemptID, &sessionID, &typ,
		&joined.userPasswordFK, &joined.userTotpFK, &joined.userPasskeyFK, &joined.userRecoveryCodesFK,
		&startedAt, &succeededAt, &failedAt, &handedOffAt, &failureCount, &challenge, &factor, &supersedes,
	}
	targets = append(targets, joined.scanTargets()...)
	if err := rows.Scan(targets...); err != nil {
		return nil, err
	}
	return scanAuthChecker(projectID, id, authAttemptID, sessionID, domain.AuthCheckType(typ),
		startedAt, succeededAt, failedAt, handedOffAt, failureCount, challenge, factor, supersedes, joined)
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
		case ac.UserPassword != nil:
			changes = []database.Change{f.passwords.ResetFailedAttempts()}
		case ac.UserTOTP != nil:
			changes = []database.Change{f.totp.ResetFailedAttempts()}
		case ac.UserRecoveryCodes != nil:
			changes = []database.Change{f.recovery.ResetFailedAttempts()}
		default:
			return nil
		}
	} else if ac.FailureCount > 0 {
		switch {
		case ac.UserPassword != nil:
			changes = []database.Change{f.passwords.AddFailedAttempts(int16(ac.FailureCount))}
		case ac.UserTOTP != nil:
			changes = []database.Change{f.totp.AddFailedAttempts(int16(ac.FailureCount))}
		case ac.UserRecoveryCodes != nil:
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
	case ac.UserPassword != nil:
		return NewUserPasswordRepository().PrimaryKeyCondition(ac.UserPassword.ID)
	case ac.UserTOTP != nil:
		return NewUserTOTPRepository().PrimaryKeyCondition(ac.UserTOTP.ID)
	case ac.UserRecoveryCodes != nil:
		return NewUserRecoveryCodesRepository().PrimaryKeyCondition(ac.UserRecoveryCodes.ID)
	default:
		return nil
	}
}

func appendCredentialUpdatedAt(ac *domain.AuthCheck, f *credentialFailureFlusher, changes []database.Change) []database.Change {
	switch {
	case ac.UserPassword != nil:
		return append(changes, database.NewChange(f.passwords.UpdatedAtColumn(), database.NowInstruction))
	case ac.UserTOTP != nil:
		return append(changes, database.NewChange(f.totp.UpdatedAtColumn(), database.NowInstruction))
	case ac.UserRecoveryCodes != nil:
		return append(changes, database.NewChange(f.recovery.UpdatedAtColumn(), database.NowInstruction))
	default:
		return changes
	}
}

func updateCredential(ctx context.Context, client database.QueryExecutor, ac *domain.AuthCheck, f *credentialFailureFlusher, changes ...database.Change) (int64, error) {
	changes = appendCredentialUpdatedAt(ac, f, changes)
	switch {
	case ac.UserPassword != nil:
		return updateOne(ctx, client, f.passwords, f.passwords.PrimaryKeyCondition(ac.UserPassword.ID), changes...)
	case ac.UserTOTP != nil:
		return updateOne(ctx, client, f.totp, f.totp.PrimaryKeyCondition(ac.UserTOTP.ID), changes...)
	case ac.UserRecoveryCodes != nil:
		return updateOne(ctx, client, f.recovery, f.recovery.PrimaryKeyCondition(ac.UserRecoveryCodes.ID), changes...)
	default:
		return 0, nil
	}
}

func deleteSessionChecksForCredential(ctx context.Context, client database.QueryExecutor, projectID, sessionID string, checker domain.AuthChecker) error {
	ac := checker.Check()
	if ac == nil {
		return nil
	}
	col, id, ok := ac.PersistCredentialFK()
	if !ok {
		return nil
	}
	d := checksDialectFor(client)
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
