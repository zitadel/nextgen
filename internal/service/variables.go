package service

import (
	"context"
	"errors"
	"slices"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/variableset"
)

type VariableToSet struct {
	Name     string
	Value    any
	IsSecret bool
}

// VariableService reads and writes the variables one owner entered (ADR 062,
// ADR 069).
//
// The owner is the project. Storage matches the owner column exactly, so a
// value another project entered can never reach a caller here. The primary
// key is the name, that owner and the kind of target the value applies to,
// primary or preview. Every method takes the kind it addresses; nil addresses
// both kinds, so a read may yield two variables per name, one per kind, and
// a caller that wants one value per name names the kind.
type VariableService interface {
	// GetVariables returns the variables owner entered under names (all of
	// them when none are given) for kind, or for both kinds when kind is nil,
	// the primary rows first. Each variable carries its kind. The per-kind
	// reads are separate statements, so a concurrent write may land between
	// them; a read tolerates that, since each kind's rows are consistent on
	// their own.
	GetVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, names ...string) ([]*domain.Variable, error)
	// GetDecryptedVariables is GetVariables with every secret decrypted and
	// still marked as one, so a caller can redact what it must not print.
	//
	// It must never back an API response: no endpoint returns a secret in
	// clear. It exists for server-side consumers that use the value itself,
	// such as the SSO flow presenting a client secret to a provider.
	GetDecryptedVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, names ...string) ([]*domain.Variable, error)
	// SetVariables applies one batch whole or not at all. A nil value removes
	// the name. With a kind, only that kind's rows are written or removed.
	// Without one, a plain value is written for both kinds, a secret for
	// primary only, removing the name's preview row, and a removal removes
	// both. Removing a name the owner does
	// not hold is not an error. A write after which the variables of a kind
	// would not fit in one deployment is refused with ErrVariableLimitExceeded.
	SetVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, variablesToSet []VariableToSet) error
	// DeleteVariable removes the name for kind, or for both kinds when kind
	// is nil. It is ErrVariableNotFound when no addressed row existed.
	DeleteVariable(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, name string) error
	ReplaceVariablesInPlace(ctx context.Context, owner domain.VariableOwner, doc map[string]any) error
}

type variableService struct {
	v2Pool *DB
	keys   KeyService
}

func NewVariableService(
	v2Pool *DB,
	keys KeyService,
) VariableService {
	return &variableService{
		v2Pool: v2Pool,
		keys:   keys,
	}
}

// selectedKinds is the kinds a request addresses: the one it named, or both
// when it named none, primary first.
func selectedKinds(kind *domain.DeploymentOriginKind) []domain.DeploymentOriginKind {
	if kind != nil {
		return []domain.DeploymentOriginKind{*kind}
	}
	return []domain.DeploymentOriginKind{domain.DeploymentOriginKindPrimary, domain.DeploymentOriginKindPreview}
}

// kindsOfWrite is the kinds a write lands in. With a kind named it is that
// kind. Without one, a plain value applies to both targets, while a secret is
// written to primary only: a preview URL is reachable by anyone who can guess
// it, so a secret never reaches it unless the caller names preview (ADR 069).
// Such a write also removes the name's preview row, see [clearsPreview].
func kindsOfWrite(kind *domain.DeploymentOriginKind, isSecret bool) []domain.DeploymentOriginKind {
	if kind == nil && isSecret {
		return []domain.DeploymentOriginKind{domain.DeploymentOriginKindPrimary}
	}
	return selectedKinds(kind)
}

// clearsPreview reports whether a write removes the name's preview row. A
// secret written without a kind does: the value it replaces is usually the
// plaintext the caller meant to protect, and a preview row left behind would
// keep serving it to previews and read back in clear. A preview secret is set
// by naming preview.
func clearsPreview(kind *domain.DeploymentOriginKind, isSecret bool) bool {
	return kind == nil && isSecret
}

func (s *variableService) GetVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, names ...string) (_ []*domain.Variable, err error) {
	ctx, end := startSpan(ctx, "VariableService.GetVariables")
	defer end(&err)

	var variables []*domain.Variable
	for _, kind := range selectedKinds(kind) {
		rows, err := s.v2Pool.Statements().GetVariables(ctx, owner, kind, names...)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to get variables from database")
		}
		variables = append(variables, rows...)
	}
	return variables, nil
}

func (s *variableService) GetDecryptedVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, names ...string) (_ []*domain.Variable, err error) {
	ctx, end := startSpan(ctx, "VariableService.GetDecryptedVariables")
	defer end(&err)

	variables, err := s.GetVariables(ctx, owner, kind, names...)
	if err != nil {
		return nil, err
	}

	// Built once and shared, so several secrets under one key cost one lookup;
	// built lazily, so a read holding no secret never reaches the key service.
	var decrypter crypto.Decrypter

	decrypted := make([]*domain.Variable, 0, len(variables))
	for _, variable := range variables {
		if !variable.IsSecret {
			decrypted = append(decrypted, variable)
			continue
		}
		if decrypter == nil {
			decrypter = decrypterOfWritingKey(ctx, s.keys)
		}
		value, err := variable.GetDecryptedValue(decrypter)
		if err != nil {
			return nil, domain.ErrFailedToDecryptVariable(err).WithDetails(map[string]any{"name": variable.Name})
		}
		decrypted = append(decrypted, &domain.Variable{
			Name:     variable.Name,
			Owner:    variable.Owner,
			Kind:     variable.Kind,
			Value:    value,
			IsSecret: true,
		})
	}
	return decrypted, nil
}

// variableRemoval addresses one row a batch removes.
type variableRemoval struct {
	name string
	kind domain.DeploymentOriginKind
}

func (s *variableService) SetVariables(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, variablesToSet []VariableToSet) (err error) {
	ctx, end := startSpan(ctx, "VariableService.SetVariables")
	defer end(&err)

	if len(variablesToSet) == 0 {
		return nil
	}

	var crypter crypto.Crypter

	containsSecret := slices.ContainsFunc(variablesToSet, func(set VariableToSet) bool {
		return set.IsSecret
	})
	if containsSecret {
		crypter, err = s.keys.GetProjectCrypter(ctx, owner.ProjectID, domain.EncryptionKeyPurposeSecret)
		if err != nil {
			return err
		}
	}

	// Everything is built before the transaction opens: a Spanner abort replays
	// the callback, so it has to be a pure function of what is captured here,
	// and a secret is encrypted once however many kinds it lands in.
	var varsToWrite []*domain.Variable
	var removals []variableRemoval
	var writtenKinds []domain.DeploymentOriginKind
	for _, varToSet := range variablesToSet {
		if varToSet.Value == nil {
			for _, kind := range selectedKinds(kind) {
				removals = append(removals, variableRemoval{name: varToSet.Name, kind: kind})
			}
			continue
		}
		var v *domain.Variable
		if varToSet.IsSecret {
			v, err = domain.NewSecretVariable(varToSet.Name, owner, varToSet.Value, crypter)
		} else {
			v, err = domain.NewVariable(varToSet.Name, owner, varToSet.Value)
		}
		if err != nil {
			return err
		}
		if clearsPreview(kind, varToSet.IsSecret) {
			removals = append(removals, variableRemoval{name: varToSet.Name, kind: domain.DeploymentOriginKindPreview})
		}
		for _, kind := range kindsOfWrite(kind, varToSet.IsSecret) {
			row := *v
			row.Kind = kind
			varsToWrite = append(varsToWrite, &row)
			if !slices.Contains(writtenKinds, kind) {
				writtenKinds = append(writtenKinds, kind)
			}
		}
	}

	// One transaction even for a single write: the audit event has to land
	// with the row it records, and the cap has to be measured against what
	// the write leaves behind.
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		sizesBefore, err := measureVariableSets(ctx, stmts, owner, writtenKinds)
		if err != nil {
			return err
		}
		for _, removal := range removals {
			err := stmts.DeleteVariable(ctx, owner, removal.kind, removal.name)
			// Not DeleteVariable's "not found": a body states what the owner
			// holds afterwards, and a name it never held already satisfies
			// that. It is also what makes the request safe to retry. Nothing
			// was removed, so there is nothing to record either.
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			if err != nil {
				return err
			}
			if err := emitVariableRemoved(ctx, stmts, owner, removal.kind, removal.name); err != nil {
				return err
			}
		}
		for _, v := range varsToWrite {
			// The cause travels: a Spanner abort has to stay matchable for
			// ReadWriteTransaction to retry the callback.
			if err := stmts.SetVariable(ctx, v); err != nil {
				return err
			}
			if err := emitVariableSet(ctx, stmts, v); err != nil {
				return err
			}
		}
		sizesAfter, err := measureVariableSets(ctx, stmts, owner, writtenKinds)
		if err != nil {
			return err
		}
		return checkVariableSetCap(writtenKinds, sizesBefore, sizesAfter)
	})
	if err != nil {
		return setVariableError(err)
	}
	return nil
}

// measureVariableSets is the size of each kind in kinds as a freeze would
// store it: the rows of that kind read back inside the transaction, encoded
// as the entries column. Pure removals are never measured, since they only
// ever shrink a set.
//
// No lock is taken against a concurrent write to the same kind. Spanner, the
// one dialect whose cell the cap protects, runs read-write transactions
// serializably, and SQLite has a single writer. A Postgres read-committed race
// could overshoot the cap, and Postgres JSONB has no cell limit for that to
// trip.
func measureVariableSets(ctx context.Context, stmts VariableStatements, owner domain.VariableOwner, kinds []domain.DeploymentOriginKind) ([]int, error) {
	sizes := make([]int, 0, len(kinds))
	for _, kind := range kinds {
		vars, err := stmts.GetVariables(ctx, owner, kind)
		if err != nil {
			return nil, err
		}
		set, err := domain.NewVariableSet(owner.ProjectID, vars)
		if err != nil {
			return nil, err
		}
		entries, err := variableset.MarshalEntries(set.Entries)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to measure the variables of a kind")
		}
		sizes = append(sizes, len(entries))
	}
	return sizes, nil
}

// checkVariableSetCap fails the transaction when a kind the batch wrote ended
// up over the cap and larger than it was. A kind can already be over the cap
// when the write starts -- after the cap was lowered, or after a Postgres race
// overshot it -- and a write that shrinks it must still get through, or the
// only way back under the cap would be a removal.
func checkVariableSetCap(kinds []domain.DeploymentOriginKind, sizesBefore, sizesAfter []int) error {
	for i, kind := range kinds {
		if sizesAfter[i] > domain.MaxVariableSetBytes && sizesAfter[i] > sizesBefore[i] {
			return domain.ErrVariableLimitExceeded().WithDetails(map[string]any{
				"kind":  kind.String(),
				"size":  sizesAfter[i],
				"limit": domain.MaxVariableSetBytes,
			})
		}
	}
	return nil
}

// setVariableError keeps a domain error as it is, the cap refusal among them.
// The project reference is the one foreign key a write can trip: the project
// was resolved from the request, so it was deleted between the access check
// and the write.
func setVariableError(err error) error {
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return domain.ErrProjectNotFound().WithParent(err)
	}
	return domain.ErrInternal(err).WithMessage("failed to write variable to database")
}

func (s *variableService) DeleteVariable(ctx context.Context, owner domain.VariableOwner, kind *domain.DeploymentOriginKind, name string) (err error) {
	ctx, end := startSpan(ctx, "VariableService.DeleteVariable")
	defer end(&err)

	kinds := selectedKinds(kind)
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		// Without a kind the name is gone from both kinds afterwards, and it
		// is "not found" only when neither held it: a row for one kind alone
		// is a variable the caller can see and remove.
		var missing error
		removed := 0
		for _, kind := range kinds {
			err := stmts.DeleteVariable(ctx, owner, kind, name)
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				missing = err
				continue
			}
			if err != nil {
				return err
			}
			removed++
			if err := emitVariableRemoved(ctx, stmts, owner, kind, name); err != nil {
				return err
			}
		}
		if removed == 0 {
			return domain.ErrVariableNotFound().WithParent(missing)
		}
		return nil
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return de
		}
		return domain.ErrInternal(err).WithMessage("failed to delete variable from database")
	}
	return nil
}

func emitVariableSet(ctx context.Context, stmts EventStatements, v *domain.Variable) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeVariableSet,
		Category:   domain.EventCategoryEntity,
		ProjectID:  v.Owner.ProjectID,
		EntityType: "variable",
		EntityID:   v.Name,
		Payload: domain.VariableSetPayload{
			Kind:   v.Kind.String(),
			Secret: v.IsSecret,
		},
	})
}

func emitVariableRemoved(ctx context.Context, stmts EventStatements, owner domain.VariableOwner, kind domain.DeploymentOriginKind, name string) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeVariableRemoved,
		Category:   domain.EventCategoryEntity,
		ProjectID:  owner.ProjectID,
		EntityType: "variable",
		EntityID:   name,
		Payload: domain.VariableRemovedPayload{
			Kind: kind.String(),
		},
	})
}

func (s *variableService) ReplaceVariablesInPlace(ctx context.Context, owner domain.VariableOwner, doc map[string]any) (err error) {
	ctx, end := startSpan(ctx, "VariableService.ReplaceVariablesInPlace")
	defer end(&err)

	placeholders, err := domain.ScanDocumentForVariables(doc)
	if err != nil {
		return err
	}
	if len(placeholders) == 0 {
		return nil
	}

	// One name per query term, however many placeholders reference it.
	variableNames := make([]string, 0, len(placeholders))
	seen := make(map[string]bool, len(placeholders))
	for _, placeholder := range placeholders {
		if seen[placeholder.VariableName] {
			continue
		}
		seen[placeholder.VariableName] = true
		variableNames = append(variableNames, placeholder.VariableName)
	}

	// Resolved against the primary rows: which kind a document resolves
	// against is the deployment's, and resolving from the set a deployment
	// froze is still to come. Until then the primary values are the ones a
	// document sees.
	varList, err := s.v2Pool.Statements().GetVariables(ctx, owner, domain.DeploymentOriginKindPrimary, variableNames...)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to get variables from database")
	}
	varMap := domain.VariableListToMap(varList)

	if err := domain.ValidateSecretPlaceholders(placeholders, varMap); err != nil {
		return err
	}

	var containsSecrets bool
	for _, v := range varMap {
		if v.IsSecret {
			containsSecrets = true
			break
		}
	}

	if containsSecrets {
		varMap, err = domain.Variables(varMap).DecryptAll(decrypterOfWritingKey(ctx, s.keys))
		if err != nil {
			return err
		}
	}

	if err := domain.ReplaceVariables(placeholders, varMap); err != nil {
		return err
	}

	return nil
}

// decrypterOfWritingKey decrypts with the key each ciphertext names in its JWE
// header, not the owner's currently active key, so a value written before a
// rotation still decrypts. Variables and the SSO callback's PKCE verifier both
// decrypt through this.
func decrypterOfWritingKey(ctx context.Context, keys KeyService) crypto.Decrypter {
	crypters := make(map[string]crypto.Decrypter)

	return crypto.DecrypterFn(func(encrypted string) (string, error) {
		header, err := domain.DecodeJWEHeader(encrypted)
		if err != nil {
			return "", domain.ErrInternal(err).WithMessage("failed to decode the header of an encrypted value")
		}

		crypter, ok := crypters[header.KeyID]
		if !ok {
			crypter, err = keys.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
			if err != nil {
				return "", err
			}
			crypters[header.KeyID] = crypter
		}
		return crypter.Decrypt(encrypted)
	})
}
