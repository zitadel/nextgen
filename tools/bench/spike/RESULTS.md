# Measured results — issue #1095 spike

Measured 2026-10-02 on a workstation (Framework Laptop 16, AMD Ryzen AI 9 HX 370, 24 threads, 58 GB), k6 and server on the same host, server built from `b44b907bd` on SQLite with quiet logs. Each run: one scenario, one shape, `constant-vus` for 20 s. Durations in ms; phases are p95. `series` is the number of distinct time series k6 emitted in the run. `reused` is the module's own connection-reuse rate (owned shapes only; k6 does not expose it for the others).

Nothing here is comparable with anything but the other rows of this table: it is a localhost SQLite lane, which is the deployment shape ADR 028 calls not a production peer.

## Main sweep

    commit=b44b907bd
    host=rog cpu=24 k6=k6 v2.3.0 (go1.27.1-X:nodwarf5, linux/amd64)
    dur=20s vus=1 5 20 shapes=owned owned-shared delegated prepared scens=login getUser

| scenario | op | vus | shape | n | req/s | failed | series | dur p50 | dur p95 | blocked p95 | conn p95 | send p95 | wait p95 | recv p95 | reused |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| getUser | get_user | 1 | delegated | 26099 | 1305 | 0 | 15 | 0.55 | 1.30 | 0.003 | 0.000 | 0.017 | 1.25 | 0.043 |  |
| getUser | get_user | 1 | owned | 23902 | 1195 | 0 | 15 | 0.70 | 1.26 | 0.003 | 0.000 | 0.012 | 1.21 | 0.031 | 100% |
| getUser | get_user | 1 | owned-shared | 26369 | 1319 | 0 | 15 | 0.55 | 1.32 | 0.004 | 0.000 | 0.013 | 1.28 | 0.037 | 100% |
| getUser | get_user | 1 | prepared | 27524 | 1376 | 0 | 15 | 0.54 | 1.20 | 0.003 | 0.000 | 0.009 | 1.16 | 0.034 |  |
| getUser | get_user | 5 | delegated | 36143 | 1807 | 0 | 15 | 2.41 | 5.00 | 0.003 | 0.000 | 0.017 | 4.97 | 0.042 |  |
| getUser | get_user | 5 | owned | 36223 | 1811 | 0 | 15 | 2.41 | 5.03 | 0.003 | 0.000 | 0.012 | 5.01 | 0.033 | 100% |
| getUser | get_user | 5 | owned-shared | 36672 | 1834 | 0 | 15 | 2.36 | 5.00 | 0.003 | 0.000 | 0.013 | 4.98 | 0.036 | 100% |
| getUser | get_user | 5 | prepared | 36295 | 1815 | 0 | 15 | 2.39 | 4.98 | 0.003 | 0.000 | 0.011 | 4.95 | 0.040 |  |
| getUser | get_user | 20 | delegated | 35830 | 1792 | 0 | 15 | 10.29 | 20.00 | 0.003 | 0.000 | 0.017 | 19.97 | 0.042 |  |
| getUser | get_user | 20 | owned | 35497 | 1775 | 0 | 15 | 10.37 | 20.44 | 0.003 | 0.000 | 0.013 | 20.42 | 0.036 | 100% |
| getUser | get_user | 20 | owned-shared | 36445 | 1823 | 0 | 15 | 10.11 | 19.88 | 0.004 | 0.000 | 0.013 | 19.85 | 0.037 | 100% |
| getUser | get_user | 20 | prepared | 34183 | 1709 | 0 | 15 | 10.74 | 21.28 | 0.004 | 0.000 | 0.013 | 21.25 | 0.050 |  |
| login | create_flow | 1 | delegated | 503 | 25 | 0 | 34 | 1.43 | 3.00 | 0.006 | 0.000 | 0.026 | 2.94 | 0.078 |  |
| login | create_flow | 1 | owned | 514 | 26 | 0 | 33 | 1.35 | 2.86 | 0.006 | 0.000 | 0.028 | 2.79 | 0.069 | 100% |
| login | create_flow | 1 | owned-shared | 508 | 25 | 0 | 33 | 1.39 | 2.80 | 0.007 | 0.000 | 0.030 | 2.74 | 0.070 | 100% |
| login | create_flow | 1 | prepared | 501 | 25 | 0 | 33 | 1.45 | 2.75 | 0.006 | 0.000 | 0.027 | 2.66 | 0.080 |  |
| login | create_flow | 5 | delegated | 1123 | 56 | 0 | 34 | 4.22 | 26.58 | 0.012 | 0.000 | 0.042 | 26.52 | 0.131 |  |
| login | create_flow | 5 | owned | 1131 | 56 | 0 | 33 | 4.05 | 24.85 | 0.009 | 0.000 | 0.042 | 24.80 | 0.091 | 100% |
| login | create_flow | 5 | owned-shared | 1129 | 56 | 0 | 33 | 4.02 | 23.54 | 0.011 | 0.000 | 0.046 | 23.49 | 0.110 | 100% |
| login | create_flow | 5 | prepared | 1128 | 56 | 0 | 33 | 4.10 | 27.15 | 0.010 | 0.000 | 0.043 | 27.09 | 0.121 |  |
| login | create_flow | 20 | delegated | 1330 | 66 | 0 | 34 | 33.11 | 95.03 | 0.019 | 0.000 | 0.073 | 94.87 | 0.255 |  |
| login | create_flow | 20 | owned | 1330 | 66 | 0 | 33 | 30.28 | 86.44 | 0.018 | 0.000 | 0.074 | 86.28 | 0.222 | 98% |
| login | create_flow | 20 | owned-shared | 1317 | 65 | 0 | 33 | 29.00 | 91.27 | 0.019 | 0.000 | 0.075 | 91.14 | 0.220 | 98% |
| login | create_flow | 20 | prepared | 1332 | 66 | 0 | 33 | 32.88 | 90.87 | 0.020 | 0.000 | 0.080 | 90.72 | 0.261 |  |
| login | submit_identifier | 1 | delegated | 503 | 25 | 0 | 34 | 1.21 | 1.94 | 0.005 | 0.000 | 0.023 | 1.84 | 0.064 |  |
| login | submit_identifier | 1 | owned | 514 | 26 | 0 | 33 | 1.13 | 1.91 | 0.006 | 0.000 | 0.024 | 1.84 | 0.056 | 100% |
| login | submit_identifier | 1 | owned-shared | 508 | 25 | 0 | 33 | 1.13 | 1.86 | 0.006 | 0.000 | 0.022 | 1.80 | 0.061 | 100% |
| login | submit_identifier | 1 | prepared | 501 | 25 | 0 | 33 | 1.26 | 2.02 | 0.005 | 0.000 | 0.023 | 1.93 | 0.072 |  |
| login | submit_identifier | 5 | delegated | 1123 | 56 | 0 | 34 | 4.77 | 10.78 | 0.008 | 0.000 | 0.032 | 10.63 | 0.153 |  |
| login | submit_identifier | 5 | owned | 1131 | 56 | 0 | 33 | 4.61 | 10.04 | 0.007 | 0.000 | 0.028 | 9.96 | 0.119 | 100% |
| login | submit_identifier | 5 | owned-shared | 1129 | 56 | 0 | 33 | 4.71 | 12.55 | 0.010 | 0.000 | 0.031 | 12.47 | 0.139 | 100% |
| login | submit_identifier | 5 | prepared | 1128 | 56 | 0 | 33 | 4.69 | 12.20 | 0.009 | 0.000 | 0.034 | 12.01 | 0.150 |  |
| login | submit_identifier | 20 | delegated | 1330 | 66 | 0 | 34 | 54.78 | 125.72 | 0.021 | 0.000 | 0.063 | 125.39 | 0.300 |  |
| login | submit_identifier | 20 | owned | 1330 | 66 | 0 | 33 | 46.46 | 121.21 | 0.017 | 0.000 | 0.062 | 121.06 | 0.241 | 100% |
| login | submit_identifier | 20 | owned-shared | 1317 | 65 | 0 | 33 | 47.94 | 123.96 | 0.021 | 0.000 | 0.063 | 123.74 | 0.257 | 100% |
| login | submit_identifier | 20 | prepared | 1332 | 66 | 0 | 33 | 51.71 | 129.84 | 0.019 | 0.000 | 0.069 | 129.72 | 0.299 |  |
| login | submit_password | 1 | delegated | 503 | 25 | 0 | 34 | 36.49 | 40.00 | 0.005 | 0.000 | 0.019 | 39.93 | 0.098 |  |
| login | submit_password | 1 | owned | 514 | 26 | 0 | 33 | 35.79 | 39.47 | 0.005 | 0.000 | 0.020 | 39.39 | 0.080 | 100% |
| login | submit_password | 1 | owned-shared | 508 | 25 | 0 | 33 | 35.93 | 39.69 | 0.006 | 0.000 | 0.019 | 39.62 | 0.081 | 100% |
| login | submit_password | 1 | prepared | 501 | 25 | 0 | 33 | 36.43 | 40.21 | 0.005 | 0.000 | 0.023 | 40.11 | 0.105 |  |
| login | submit_password | 5 | delegated | 1123 | 56 | 0 | 34 | 75.55 | 97.00 | 0.011 | 0.000 | 0.043 | 96.91 | 0.166 |  |
| login | submit_password | 5 | owned | 1131 | 56 | 0 | 33 | 75.74 | 96.90 | 0.010 | 0.000 | 0.038 | 96.85 | 0.118 | 100% |
| login | submit_password | 5 | owned-shared | 1129 | 56 | 0 | 33 | 75.84 | 97.72 | 0.013 | 0.000 | 0.044 | 97.63 | 0.127 | 100% |
| login | submit_password | 5 | prepared | 1128 | 56 | 0 | 33 | 75.13 | 98.64 | 0.011 | 0.000 | 0.049 | 98.53 | 0.154 |  |
| login | submit_password | 20 | delegated | 1330 | 66 | 0 | 34 | 199.90 | 270.85 | 0.023 | 0.000 | 0.083 | 270.74 | 0.273 |  |
| login | submit_password | 20 | owned | 1330 | 66 | 0 | 33 | 213.13 | 279.60 | 0.024 | 0.000 | 0.077 | 279.53 | 0.217 | 100% |
| login | submit_password | 20 | owned-shared | 1317 | 65 | 0 | 33 | 212.03 | 282.31 | 0.027 | 0.000 | 0.077 | 282.26 | 0.239 | 100% |
| login | submit_password | 20 | prepared | 1332 | 66 | 0 | 33 | 204.04 | 273.62 | 0.025 | 0.000 | 0.088 | 273.44 | 0.264 |  |

## Naive tags (prepared-naive.js, login, 5 VUs)

| scenario | op | vus | shape | n | req/s | failed | series | dur p50 | dur p95 | blocked p95 | conn p95 | send p95 | wait p95 | recv p95 | reused |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| login | - | 5 | prepared-naive | 3342 | 167 | 0 | 10041 | 5.70 | 86.34 | 0.011 | 0.000 | 0.042 | 86.25 | 0.154 |  |

## JavaScript in the entry script (non-blank, non-comment lines)

- owned.js: 9
- delegated.js: 9
- prepared.js: 21
- prepared-naive.js: 22
- scenarios.js: 12

scenarios.js is shared by all entry scripts.
