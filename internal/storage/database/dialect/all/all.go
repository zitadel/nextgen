package all

import (
	_ "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	_ "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	_ "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)
