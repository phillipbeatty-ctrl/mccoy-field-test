# SPOTIO Release Invariants

The RC1 SPOTIO change is acceptable only while all of these remain true:

1. A later import never hides an older active canonical lead merely because it is absent from that file.
2. Re-importing the same lead resolves to the same canonical McCoy lead ID.
3. Provider imports cannot clear McCoy assignment, disposition, activity, or verified-location data.
4. Incomplete address rows do not become Lead Pool pins.
5. Admin, Manager/Trainer, and Rep/Tester visibility remains organization- and assignment-scoped.
6. Historical merges retain audit records and reparent dependent records before duplicate rows are archived.
7. No import automatically archives a missing lead; removal requires an explicit authorized action.
