# Post-fix #549 verification

- **Verdict**: **PASS**
- **Device**: 192.168.1.4:5555 (Pixel 9 Pro XL)
- **Android**: 16
- **Runs**: 5
- **Generated**: 2026-04-14T11:58:15Z

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

### Run 1 — 2026-04-14T11:45:42Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"58.0","avgCreateMs":"17.3"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"25.8"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 2 — 2026-04-14T11:48:15Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"65.6","avgCreateMs":"20.6"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"20.2"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 3 — 2026-04-14T11:50:45Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"63.0","avgCreateMs":"19.1"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"24.4"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 4 — 2026-04-14T11:53:15Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"63.4","avgCreateMs":"19.6"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"24.1"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 5 — 2026-04-14T11:55:45Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"64.3","avgCreateMs":"18.3"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"23.1"}
D: {"finalCount":0,"finalIds":[]}
```
