# Delayed source timing

CBOE root `timestamp` is publication time. It must not authorize price buckets newer than the delayed source observation. For liquid QQQ, the reported underlying last-trade event anchors valuation and the last eligible closed price bucket only when its lag agrees with the declared source delay within two minutes and both events have the same market date. No timestamp is produced by subtracting the nominal delay. Invalid or absent event anchors retain partial inputs and cannot publish a verified day.

This is an underlying-event anchor, not a claim that CBOE supplies the exact event time of each option quote. Publication, receipt, underlying event, declared delay, missing IV, and the alignment basis remain separately recorded. Missing IV is not imputed. Delayed observations do not qualify as real-time PCS inputs.

2026-11-16 Linux verification: publication 14:51:18 UTC, reported underlying event 14:36:17 UTC; all 29 expiry valuations use that event and all 2239 retained bucket ends are <= event (latest 14:36:00). 282 positive-OI contracts lack IV, so inputComplete=false. Earlier source HTTP samples crossed 14:45 UTC: underlying/option last trade changed from Friday to Monday 09:30 ET, consistent with the 15-minute delayed source.

Tests: 80 automation tests passed; source-timing regression rejects same-day unverified events; existing incremental/history/corruption pipeline passed; web build passed. These are not native Mac continuous-recording acceptance.
