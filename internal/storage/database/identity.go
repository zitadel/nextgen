package database

import v2database "github.com/zitadel/nextgen/internal/storage/v2/database"

// Identity is owned by storage v2; keep a v1 alias for remaining interim callers.
type Identity = v2database.Identity
