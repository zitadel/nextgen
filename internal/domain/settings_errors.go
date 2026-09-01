package domain

// PrefixSetting namespaces setting error codes. It is not an id-minting prefix:
// a setting leaf is keyed by its path and owner (ADR 047 governs minted
// resource PKs), so nothing ever generates a "setting_" id.
const PrefixSetting ResourcePrefix = "setting"

// ErrSettingNotFound reports that no leaf at or above the requester's level
// carries a value for the requested path. Callers that have a built-in default
// should treat this as "unset" rather than as a failure.
func ErrSettingNotFound() Error {
	return newError(PrefixSetting.ErrorCodePrefix("not_found"), "setting: not found", nil, nil)
}
