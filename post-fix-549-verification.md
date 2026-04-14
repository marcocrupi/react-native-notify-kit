# Post-fix #549 verification

- **Verdict**: **PASS**
- **Device**: 192.168.1.4:5555 (Pixel 9 Pro XL)
- **Android**: 16
- **Runs**: 5
- **Generated**: 2026-04-14T12:28:37Z

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

### Run 1 — 2026-04-14T12:16:09Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"59.9","avgCreateMs":"16.8"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"24.8"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 2 — 2026-04-14T12:18:39Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"62.6","avgCreateMs":"18.8"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"24.0"}
D: {"finalCount":1,"finalIds":["d-19"]}
```

### Run 3 — 2026-04-14T12:21:09Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"61.5","avgCreateMs":"17.0"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"25.1"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 4 — 2026-04-14T12:23:37Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"63.7","avgCreateMs":"18.4"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"24.1"}
D: {"finalCount":0,"finalIds":[]}
```

### Run 5 — 2026-04-14T12:26:07Z

```json
A: {"total":20,"canaryMissingAtZero":0,"canaryMissingAt100":0,"canaryLostPermanent":0,"avgCancelMs":"60.5","avgCreateMs":"19.6"}
B: {"total":30,"immediatelyNonZero":0,"after50NonZero":0,"after500NonZero":0,"maxImmediately":0}
C: {"total":30,"immediatelyMissing":0,"after50Missing":0,"after500Missing":0,"avgCreateMs":"23.3"}
D: {"finalCount":0,"finalIds":[]}
```
