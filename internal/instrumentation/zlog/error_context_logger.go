package zlog

import (
	"context"
	"log/slog"
	"os"

	"github.com/zitadel/sloggcp"
)

// exit is a variable to allow testing of Fatal without exiting the test process.
var exit = os.Exit

type ErrorContextLogger struct {
	ctx    context.Context
	logger *slog.Logger
	// canTerminate sets whether Panic/Fatal should actually call panic or os.Exit.
	// False when OnError returned a no-op logger, true in all other cases.
	canTerminate bool
}

func (l *ErrorContextLogger) Debug(msg string, args ...any) {
	log(l.ctx, l.logger, slog.LevelDebug, msg, 1, args...)
}

func (l *ErrorContextLogger) Info(msg string, args ...any) {
	log(l.ctx, l.logger, slog.LevelInfo, msg, 1, args...)
}

func (l *ErrorContextLogger) Warn(msg string, args ...any) {
	log(l.ctx, l.logger, slog.LevelWarn, msg, 1, args...)
}

func (l *ErrorContextLogger) Error(msg string, args ...any) {
	log(l.ctx, l.logger, slog.LevelError, msg, 1, args...)
}

// Panic logs a [sloggcp.LevelAlert] leveled message and panics.
// If the logger was created via [OnError] with a nil error, this method does nothing.
func (l *ErrorContextLogger) Panic(msg string, args ...any) {
	log(l.ctx, l.logger, sloggcp.LevelAlert, msg, 1, args...)
	if l.canTerminate {
		panic(msg)
	}
}

// Fatal logs a [sloggcp.LevelEmergency] leveled message and exits the application with code 1.
// If the logger was created via [OnError] with a nil error, this method does nothing.
func (l *ErrorContextLogger) Fatal(msg string, args ...any) {
	log(l.ctx, l.logger, sloggcp.LevelEmergency, msg, 1, args...)
	if l.canTerminate {
		exit(1)
	}
}
