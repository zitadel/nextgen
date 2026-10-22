package zlog

import (
	"log/slog"

	"github.com/zitadel/sloggcp"
)

type Level = slog.Level

const (
	LevelDebug     Level = slog.LevelDebug
	LevelInfo      Level = slog.LevelInfo
	LevelNotice    Level = sloggcp.LevelNotice + 2
	LevelWarning   Level = slog.LevelWarn
	LevelError     Level = slog.LevelError
	LevelCritical  Level = sloggcp.LevelCritical
	LevelAlert     Level = sloggcp.LevelAlert
	LevelEmergency Level = sloggcp.LevelEmergency
)
