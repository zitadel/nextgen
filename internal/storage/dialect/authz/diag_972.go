package authz

// DIAGNOSTIC (#972) — DO NOT MERGE.
//
// DiagListArms selects which arms of the list-predicate disjunction
// writeListAuthzRSIMatch emits, so one seeded dataset can be timed against each
// subset in a single process. Production shape is DiagListArmsAll, which emits
// byte-identical SQL to the unpatched writer.
//
// The point of the sweep: the project-scoped and TTU arms cannot reference the
// correlated RSI row r (writeScopedClosureExists takes exactly one raw-SQL
// parameter, scopeIDExpr, and those two call sites pass "" / have none), so
// their truth value is fixed once the bind arguments are bound. If timings grow
// with data volume while only those two arms are emitted, Spanner is
// re-evaluating a query-constant per outer row.
type DiagListArmMask uint8

const (
	DiagArmProjectScoped DiagListArmMask = 1 << iota
	DiagArmTTU
	DiagArmTeamScoped
	DiagArmResourceScoped

	DiagListArmsNone       DiagListArmMask = 0
	DiagListArmsConstant                   = DiagArmProjectScoped | DiagArmTTU
	DiagListArmsCorrelated                 = DiagArmTeamScoped | DiagArmResourceScoped
	DiagListArmsAll                        = DiagListArmsConstant | DiagListArmsCorrelated
)

// DiagListArms is read by writeListAuthzRSIMatch. Not synchronised: the
// benchmark is single-goroutine and nothing else writes it.
var DiagListArms = DiagListArmsAll

func (m DiagListArmMask) has(arm DiagListArmMask) bool { return m&arm != 0 }
