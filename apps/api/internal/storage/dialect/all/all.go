package all

import (
	_ "github.com/zitadel/nextgen/internal/storage/dialect/postgres"
	_ "github.com/zitadel/nextgen/internal/storage/dialect/spanner"
	_ "github.com/zitadel/nextgen/internal/storage/dialect/sqlite"
)
