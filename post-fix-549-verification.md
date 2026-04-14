# Post-fix #549 verification

- **Verdict**: **PASS**
- **Device**: 192.168.1.4:5555 (Pixel 9 Pro XL)
- **Android**: 16
- **Runs**: 5
- **Generated**: 2026-04-14T10:42:51Z

## Aggregate (across all 5 runs)

| Scenario | Metric | Count | Attempts | OK? |
|---|---|---:|---:|---|
| A | canaryMissingAtZero | 0 | 100 | ✅ |
| A | canaryLostPermanent | 0 | 100 | ✅ |
| B | immediatelyNonZero  | 0 | 150 | ✅ |
| B | after50NonZero      | 0 | 150 | ✅ |
| B | after500NonZero     | 0 | 150 | ✅ |
| C | immediatelyMissing  | 0 | 150 | ✅ |
| C | after50Missing      | 0 | 150 | ✅ |
| C | after500Missing     | 0 | 150 | ✅ |

## Per-run summaries

### Run 1 — 2026-04-14T10:30:31Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"65.8","avgCreateMs":"18.1"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"21.7"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 2 — 2026-04-14T10:32:58Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"69.3","avgCreateMs":"19.6"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"20.7"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 3 — 2026-04-14T10:35:26Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"69.7","avgCreateMs":"19.4"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"21.5"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 4 — 2026-04-14T10:37:55Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"67.8","avgCreateMs":"19.6"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"21.3"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 5 — 2026-04-14T10:40:22Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"64.4","avgCreateMs":"18.8"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"21.5"}
D: {"finalCount":0,"finalIds":[]}
```
