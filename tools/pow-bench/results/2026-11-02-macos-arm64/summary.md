# Recorded PoW measurements

Environment: {"node":"v24.22.0","platform":"darwin","os_release":"27.2.0","arch":"arm64","cpu":"Apple M5 Max","logical_cpus":18,"memory_bytes":38654705664,"esbuild":"0.28.1","worker_bytes":10050}

Times in milliseconds; nearest-rank p50 / p95 / p99. At n=32, p99 is the maximum, not a stable population estimate.

| Candidate | Native Go | Browser / variant | Browser solve | Samples | Median paired browser/native ratio |
|---|---:|---|---:|---:|---:|
| zitadel_sha256_16 | 1.95 / 10.40 / 13.06 | chromium 156.0.8078.4 / default | 51.80 / 260.20 / 306.20 | 32 | 23.1x |
| zitadel_sha256_16 | 1.95 / 10.40 / 13.06 | webkit 27.2 / default | 19.00 / 96.00 / 110.00 | 32 | 9.4x |
| zitadel_sha256_18 | 6.55 / 29.42 / 31.02 | chromium 156.0.8078.4 / default | 156.50 / 693.20 / 730.30 | 32 | 23.6x |
| zitadel_sha256_18 | 6.55 / 29.42 / 31.02 | webkit 27.2 / default | 73.00 / 326.00 / 344.00 | 32 | 11.1x |
| zitadel_sha256_20 | 27.50 / 92.16 / 163.28 | chromium 156.0.8078.4 / default | 645.10 / 2207.90 / 3836.00 | 32 | 23.5x |
| zitadel_sha256_20 | 27.50 / 92.16 / 163.28 | webkit 27.2 / default | 303.00 / 1039.00 / 1791.00 | 32 | 11.0x |
| altcha_sha256_16 | 2.29 / 17.53 / 21.11 | chromium 156.0.8078.4 / noble | 22.30 / 186.60 / 205.90 | 32 | 11.1x |
| altcha_sha256_16 | 1.44 / 21.11 / 21.11 | chromium 156.0.8078.4 / webcrypto | 20.80 / 265.10 / 265.10 | 8 | 14.2x |
| altcha_sha256_16 | 2.29 / 17.53 / 21.11 | webkit 27.2 / noble | 11.00 / 91.00 / 97.00 | 32 | 5.3x |
| altcha_sha256_16 | 1.44 / 21.11 / 21.11 | webkit 27.2 / webcrypto | 129.00 / 1822.00 / 1822.00 | 8 | 98.9x |
| altcha_sha256_20 | 33.75 / 149.29 / 195.28 | chromium 156.0.8078.4 / noble | 733.10 / 3394.60 / 4408.40 | 32 | 22.5x |
| altcha_sha256_20 | 33.75 / 149.29 / 195.28 | webkit 27.2 / noble | 558.00 / 2546.00 / 3354.00 | 32 | 17.0x |
| altcha_pbkdf2_1000 | 9.77 / 36.98 / 49.20 | chromium 156.0.8078.4 / default | 8.30 / 31.40 / 43.90 | 32 | 0.8x |
| altcha_pbkdf2_1000 | 9.77 / 36.98 / 49.20 | webkit 27.2 / default | 15.00 / 63.00 / 74.00 | 32 | 1.5x |
| altcha_pbkdf2_5000 | 51.77 / 177.30 / 297.48 | chromium 156.0.8078.4 / default | 39.70 / 134.80 / 226.40 | 32 | 0.8x |
| altcha_pbkdf2_5000 | 51.77 / 177.30 / 297.48 | webkit 27.2 / default | 72.00 / 252.00 / 409.00 | 32 | 1.4x |
| altcha_pbkdf2_precomputed | 78.00 / 199.94 / 202.41 | chromium 156.0.8078.4 / default | 59.40 / 151.00 / 155.10 | 32 | 0.8x |
| altcha_pbkdf2_precomputed | 78.00 / 199.94 / 202.41 | webkit 27.2 / default | 107.00 / 272.00 / 279.00 | 32 | 1.4x |

Server microseconds/op; includes scope/config checks, excludes persistence, network and rate guards.

| Candidate | Issue | Verify | Decode + verify | Bad work | Bad signature | Verify bytes / allocations | Challenge / proof bytes (first fixture) |
|---|---:|---:|---:|---:|---:|---:|---:|
| zitadel_sha256_16 | 3.34 | 11.53 | 15.98 | 11.57 | 5.25 | 15469 / 262 | 549 / 19 |
| zitadel_sha256_18 | 3.11 | 10.93 | 16.05 | 10.82 | 4.98 | 15469 / 262 | 549 / 20 |
| zitadel_sha256_20 | 3.10 | 10.94 | 18.39 | 10.79 | 4.86 | 15469 / 262 | 549 / 21 |
| altcha_sha256_16 | 9.46 | 14.60 | 25.99 | 14.69 | 14.97 | 18589 / 491 | 419 / 96 |
| altcha_sha256_20 | 9.44 | 14.22 | 26.07 | 14.51 | 14.07 | 18588 / 492 | 420 / 108 |
| altcha_pbkdf2_1000 | 9.45 | 94.50 | 106.62 | 94.49 | 14.36 | 19259 / 501 | 427 / 105 |
| altcha_pbkdf2_5000 | 9.69 | 412.35 | 424.91 | 411.86 | 14.80 | 19260 / 501 | 427 / 106 |
| altcha_pbkdf2_precomputed | 408.80 | 16.14 | 29.10 | 16.24 | 15.46 | 20509 / 519 | 539 / 106 |

Worker checks:

- chromium: startup 2.80 ms; terminate call 0.00 ms; maximum observed 10 ms main-thread timer interval 12.40 ms; digest vector 569acc01eb9b3c62c9f0bec110995475086a75a39b256ca360b562318f03dabb.
- webkit: startup 8.00 ms; terminate call 0.00 ms; maximum observed 10 ms main-thread timer interval 18.00 ms; digest vector 569acc01eb9b3c62c9f0bec110995475086a75a39b256ca360b562318f03dabb.
