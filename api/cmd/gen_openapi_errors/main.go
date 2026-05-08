// gen_openapi_errors generates OpenAPI default responses from service error comments.
// It automatically discovers error codes by parsing the domain package and all service files.
//
// Paths are calculated relative to this generator's location:
//   - Domain: ../../../internal/domain
//   - Service: ../../../internal/service
//   - OpenAPI: ../../openapi
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"text/template"
)

type ErrorCode struct {
	Code     string
	Filename string
	Message  string
}

type EndpointData struct {
	ErrorCodes []ErrorCode
	RefPrefix  string
}

const defaultResponseTemplate = `description: Error response
content:
  application/json:
    schema:
      oneOf:
{{- range .ErrorCodes }}
        - $ref: '{{ $.RefPrefix }}{{ .Filename }}.yaml'
{{- end }}
      discriminator:
        propertyName: code
        mapping:
{{- range .ErrorCodes }}
          {{ .Code }}: '{{ $.RefPrefix }}{{ .Filename }}.yaml'
{{- end }}
    examples:
{{- range .ErrorCodes }}
      {{ .Code }}:
        summary: {{ .Code }}
        value:
          code: {{ .Code }}
          message: {{ .Message }}
{{- end }}
`

func main() {
	// Get the directory where this generator is located
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		fmt.Fprintln(os.Stderr, "Failed to get current file path")
		os.Exit(1)
	}
	generatorDir := filepath.Dir(filename)

	// Calculate paths relative to generator location
	// Generator is at: api/cmd/gen_openapi_errors/main.go
	domainPath := filepath.Join(generatorDir, "../../../internal/domain")
	servicePath := filepath.Join(generatorDir, "../../../internal/service")
	openapiBasePath := filepath.Join(generatorDir, "../../openapi")

	// Step 1: Parse domain package to build error function -> error info mapping
	errorMapping := buildErrorMapping(domainPath)
	fmt.Printf("📋 Discovered %d error codes from domain package\n", len(errorMapping))

	// Step 2: Parse all service files to get error documentation
	allMethods := parseAllServiceFiles(servicePath)
	fmt.Printf("📋 Discovered %d service methods with error documentation\n", len(allMethods))

	// Step 3: Define endpoint mappings
	endpoints := map[string]struct {
		yamlPath      string
		serviceMethod string
	}{
		"createAuthAttempt":    {filepath.Join(openapiBasePath, "endpoints/auth_attempts/methods.yaml"), "AuthAttemptService.Create"},
		"getAuthAttempt":       {filepath.Join(openapiBasePath, "endpoints/auth_attempts/by_id/methods.yaml"), "AuthAttemptService.GetByID"},
		"issueChallenge":       {filepath.Join(openapiBasePath, "endpoints/auth_attempts/by_id/challenges/methods.yaml"), "AuthAttemptService.IssueChallenge"},
		"verifyChallengeProof": {filepath.Join(openapiBasePath, "endpoints/auth_attempts/by_id/challenges/by_id/methods.yaml"), "AuthAttemptService.VerifyProof"},
		"createHandoff":        {filepath.Join(openapiBasePath, "endpoints/auth_attempts/by_id/handoff/methods.yaml"), "AuthAttemptService.Handoff"},
	}

	tmpl := template.Must(template.New("default").Parse(defaultResponseTemplate))

	// Step 4: Generate error response files for each endpoint
	for opID, cfg := range endpoints {
		method, ok := allMethods[cfg.serviceMethod]
		if !ok {
			fmt.Printf("⚠️  Service method %s not found, skipping %s\n", cfg.serviceMethod, opID)
			continue
		}

		// Convert error functions to error codes using the auto-discovered mapping
		var errorCodes []ErrorCode
		for _, errFunc := range method.errorFuncs {
			if errInfo, ok := errorMapping[errFunc]; ok {
				errorCodes = append(errorCodes, ErrorCode{
					Code:     errInfo.code,
					Filename: strings.ReplaceAll(errInfo.code, ".", "-"),
					Message:  errInfo.message,
				})
			} else {
				fmt.Printf("⚠️  Unknown error function %s in %s\n", errFunc, cfg.serviceMethod)
			}
		}

		if len(errorCodes) == 0 {
			fmt.Printf("⚠️  No errors found for %s\n", opID)
			continue
		}

		// Calculate relative path from endpoint directory to components/schemas/errors/
		endpointDir := filepath.Dir(cfg.yamlPath)
		relPath := strings.TrimPrefix(endpointDir, openapiBasePath+string(os.PathSeparator))
		depth := strings.Count(relPath, string(os.PathSeparator)) + 1
		refPrefix := strings.Repeat("../", depth) + "components/schemas/errors/"

		// Generate the default response YAML
		var buf strings.Builder
		if err := tmpl.Execute(&buf, EndpointData{
			ErrorCodes: errorCodes,
			RefPrefix:  refPrefix,
		}); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error generating %s: %v\n", opID, err)
			continue
		}

		// Write to a unique error response file based on operation ID
		filename := fmt.Sprintf("%s-error-response.yaml", opID)
		outputPath := filepath.Join(filepath.Dir(cfg.yamlPath), filename)
		if err := os.WriteFile(outputPath, []byte(buf.String()), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error writing %s: %v\n", outputPath, err)
			continue
		}

		fmt.Printf("✅ Generated %s (%d errors)\n", filename, len(errorCodes))
	}

	fmt.Println("\n💡 Generated operation-specific error response files")
}

type errorInfo struct {
	code    string
	message string
}

// buildErrorMapping parses the domain package and extracts error function -> error info mappings
func buildErrorMapping(domainPath string) map[string]errorInfo {
	mapping := make(map[string]errorInfo)

	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, domainPath, func(fi os.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go") && fi.Name() != "cmd"
	}, parser.ParseComments)

	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing domain package: %v\n", err)
		os.Exit(1)
	}

	prefixes := extractResourcePrefixes(pkgs)

	for _, pkg := range pkgs {
		for _, file := range pkg.Files {
			ast.Inspect(file, func(n ast.Node) bool {
				funcDecl, ok := n.(*ast.FuncDecl)
				if !ok || !strings.HasPrefix(funcDecl.Name.Name, "Err") || funcDecl.Body == nil {
					return true
				}

				for _, stmt := range funcDecl.Body.List {
					retStmt, ok := stmt.(*ast.ReturnStmt)
					if !ok {
						continue
					}

					for _, result := range retStmt.Results {
						if callExpr, ok := result.(*ast.CallExpr); ok {
							if ident, ok := callExpr.Fun.(*ast.Ident); ok && ident.Name == "newError" {
								if len(callExpr.Args) >= 2 {
									code := extractCodeArgument(callExpr.Args[0], prefixes)
									message := ""
									if msgLit, ok := callExpr.Args[1].(*ast.BasicLit); ok {
										message = strings.Trim(msgLit.Value, `"`)
									}
									if code != "" {
										mapping["domain."+funcDecl.Name.Name] = errorInfo{
											code:    code,
											message: message,
										}
									}
								}
							}
						}
					}
				}

				return true
			})
		}
	}

	return mapping
}

func extractResourcePrefixes(pkgs map[string]*ast.Package) map[string]string {
	prefixes := make(map[string]string)

	for _, pkg := range pkgs {
		for _, file := range pkg.Files {
			for _, decl := range file.Decls {
				genDecl, ok := decl.(*ast.GenDecl)
				if !ok || genDecl.Tok != token.CONST {
					continue
				}

				for _, spec := range genDecl.Specs {
					valueSpec, ok := spec.(*ast.ValueSpec)
					if !ok {
						continue
					}

					for i, name := range valueSpec.Names {
						if valueSpec.Type != nil {
							if ident, ok := valueSpec.Type.(*ast.Ident); ok && ident.Name == "ResourcePrefix" {
								if i < len(valueSpec.Values) {
									if lit, ok := valueSpec.Values[i].(*ast.BasicLit); ok {
										value := strings.Trim(lit.Value, `"`)
										prefixes[name.Name] = value
									}
								}
							}
						}
					}
				}
			}
		}
	}

	return prefixes
}

func extractCodeArgument(arg ast.Expr, prefixes map[string]string) string {
	if lit, ok := arg.(*ast.BasicLit); ok {
		return strings.Trim(lit.Value, `"`)
	}

	if callExpr, ok := arg.(*ast.CallExpr); ok {
		if selExpr, ok := callExpr.Fun.(*ast.SelectorExpr); ok {
			if selExpr.Sel.Name == "ErrorCodePrefix" {
				if ident, ok := selExpr.X.(*ast.Ident); ok {
					prefixValue, ok := prefixes[ident.Name]
					if !ok {
						return ""
					}

					if len(callExpr.Args) > 0 {
						if suffixLit, ok := callExpr.Args[0].(*ast.BasicLit); ok {
							suffix := strings.Trim(suffixLit.Value, `"`)
							return prefixValue + "." + suffix
						}
					}
				}
			}
		}
	}

	return ""
}

type serviceMethod struct {
	interfaceName string
	methodName    string
	errorFuncs    []string
}

// parseAllServiceFiles scans all .go files in the service directory and extracts
// service interface methods with error documentation.
func parseAllServiceFiles(servicePath string) map[string]serviceMethod {
	allMethods := make(map[string]serviceMethod)

	files, err := filepath.Glob(filepath.Join(servicePath, "*.go"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error listing service files: %v\n", err)
		os.Exit(1)
	}

	errorPattern := regexp.MustCompile(`errors:\s*(.+)`)

	for _, filename := range files {
		if strings.HasSuffix(filename, "_test.go") {
			continue
		}

		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, filename, nil, parser.ParseComments)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing %s: %v\n", filename, err)
			continue
		}

		ast.Inspect(file, func(n ast.Node) bool {
			typeSpec, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}

			iface, ok := typeSpec.Type.(*ast.InterfaceType)
			if !ok || !strings.HasSuffix(typeSpec.Name.Name, "Service") {
				return true
			}

			interfaceName := typeSpec.Name.Name

			for _, method := range iface.Methods.List {
				if len(method.Names) == 0 || method.Doc == nil {
					continue
				}

				methodName := method.Names[0].Name

				for _, comment := range method.Doc.List {
					if matches := errorPattern.FindStringSubmatch(comment.Text); len(matches) > 1 {
						var errs []string
						for _, e := range strings.Split(matches[1], ",") {
							errs = append(errs, strings.TrimSpace(e))
						}

						key := interfaceName + "." + methodName
						allMethods[key] = serviceMethod{
							interfaceName: interfaceName,
							methodName:    methodName,
							errorFuncs:    errs,
						}
						break
					}
				}
			}

			return true
		})
	}

	return allMethods
}
