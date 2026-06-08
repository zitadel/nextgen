package middleware

import (
	"log/slog"

	"github.com/ogen-go/ogen/middleware"
)

func Logging(logger *slog.Logger) middleware.Middleware {
	return func(req middleware.Request, next middleware.Next) (middleware.Response, error) {
		logger = logger.With(
			slog.String("method", req.Raw.Method),
			slog.String("pattern", req.Raw.Pattern),
			slog.String("operation", req.OperationName),
			slog.String("operationID", req.OperationID),
		)
		if traceID, ok := GetTraceID(req.Context); ok {
			logger = logger.With(slog.String("traceID", traceID))
		}

		logger.Info("Handling request")
		resp, err := next(req)
		if err != nil {
			logger.Error("Fail", slog.Any("err", err))
			return resp, err
		}

		logger.Info("Handled request")
		return resp, err
	}
}
