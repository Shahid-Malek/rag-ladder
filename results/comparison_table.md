# Final retrieval comparison

Fractions, frozen runtime processing-off mode. Raw questions; rewrite, retry and generation off; exact search. L1/L2 return chunks; L3 returns parents.

| Metric | L1 | L2 | L3 |
| --- | --- | --- | --- |
| hit@1 | 0.461957 | 0.451087 | 0.597826 |
| hit@3 | 0.684783 | 0.711957 | 0.777174 |
| hit@5 | 0.777174 | 0.793478 | 0.826087 |
| hit@10 | 0.880435 | 0.864130 | N/A |
| mrr@5 | 0.720562 | 0.753804 | 0.865580 |
| recall@5 | 0.837552 | 0.884261 | 0.918754 |
| location_hit@5 | 0.798913 | 0.869565 | 0.907609 |
| Evidence coverage@5 | 0.830616 | 0.854348 | 0.888134 |
| Answerable n | 184 | 184 | 184 |
| Total n | 200 | 200 | 200 |

## Existing frozen 95% intervals

| Metric | L1 | L2 | L3 |
| --- | --- | --- | --- |
| hit@1 | 0.461957 [0.391304, 0.532609] | 0.451087 [0.380435, 0.521739] | 0.597826 [0.527174, 0.668478] |
| hit@3 | 0.684783 [0.619565, 0.750000] | 0.711957 [0.646739, 0.777174] | 0.777174 [0.717391, 0.836957] |
| hit@5 | 0.777174 [0.717391, 0.836957] | 0.793478 [0.733696, 0.847826] | 0.826087 [0.771739, 0.880435] |
| hit@10 | 0.880435 [0.831522, 0.923913] | 0.864130 [0.815217, 0.913043] | NOT MEASURED |
| mrr@5 | 0.720562 [0.665759, 0.775093] | 0.753804 [0.703080, 0.803354] | 0.865580 [0.820740, 0.907518] |
| recall@5 | 0.837552 [0.788768, 0.883752] | 0.884261 [0.844422, 0.920635] | 0.918754 [0.887371, 0.947390] |

Retained percentile bootstrap intervals: 10,000 resamples, seed 42, sorted answerable IDs. L3 Hit@10 is unmeasured because output is capped at five parents.

## Existing paired comparisons

| Difference | Metric | Mean | 95% lower | 95% upper | Saved verdict |
| --- | --- | --- | --- | --- | --- |
| L2 minus L1 | hit@5 | 0.016304 | -0.054348 | 0.086957 | not distinguishable |
| L2 minus L1 | mrr@5 | 0.033243 | -0.029438 | 0.096196 | not distinguishable |
| L2 minus L1 | recall@5 | 0.046709 | -0.003507 | 0.098905 | not distinguishable |
| L3 minus L1 | hit@5 | 0.048913 | -0.021739 | 0.119565 | not distinguishable |
| L3 minus L1 | mrr@5 | 0.145018 | 0.080978 | 0.208967 | distinguishable |
| L3 minus L1 | recall@5 | 0.081202 | 0.028859 | 0.135214 | distinguishable |
| L3 minus L2 | hit@5 | 0.032609 | -0.021739 | 0.092391 | not distinguishable |
| L3 minus L2 | mrr@5 | 0.111775 | 0.055885 | 0.167120 | distinguishable |
| L3 minus L2 | recall@5 | 0.034493 | 0.000037 | 0.070066 | distinguishable |

Every overall Hit@5 interval includes zero. Multiple comparisons are unadjusted. The L3–L2 keyword Recall lower bound is positive but close to zero, so that result is borderline. These are dataset-specific findings, not universal rankings.

## Verification

The 3 selected input hashes and all 17 frozen quality means match the saved per-question derivations within 1e-12. Across 616 saved group/cutoff checks, 572 numeric values agree. The other 44 are disclosed empty-group representation differences: saved unanswerable-only summaries use zero; this package uses N/A, JSON null or an empty CSV score. These zeros are not observed retrieval failures. No numeric mismatch was silently resolved.

## Limits

One dataset, four neutral subjects, 37 documents, 200 questions: 184 answerable and 16 unanswerable. Quality averages exclude unanswerables. Answerable type samples have only 16–40 questions, with 4–10 per subject. This package evaluates saved retrieval, not generated answers or deployment performance. New coverage intervals and paired comparisons appear in the significance addendum; type-level findings use nominal, unadjusted thresholds. Several components change together, so these results cannot isolate a component’s causal contribution.

## Significance addendum

New saved-record inference: Hit@5 uses two-sided Wilson score 95% intervals. Coverage means and right-minus-left paired coverage differences use 10,000 question bootstrap resamples, standard-library random.Random seed 42 reset for every estimate, and linearly interpolated 2.5th/97.5th percentiles at (B−1)p. Questions are ordered by neutral ID. Paired resampling uses the same question on both levels. Improved/worsened/unchanged counts are computed separately for each metric; positive means the right level is better. Exact two-sided McNemar tests condition on discordant Hit pairs, double the smaller Binomial(n, 0.5) tail and cap at one; no mid-p correction. With no discordant pairs p=1; with no eligible questions all inference is N/A.

Distinguishable means McNemar p < 0.05 for Hit, or a paired coverage interval excluding zero. These are nominal, unadjusted comparisons; type findings are exploratory. Fewer than 20 eligible answerable questions is SMALL-SAMPLE: multi_chunk_same_doc and realistic_student each have 16. The unanswerable type has zero eligible observations. This is question-level inference for a fixed dataset, without subject/document cluster adjustment. A non-distinguishable result is compatible with sampling noise, not proof of equality. Empirical bootstrap intervals can be degenerate at all-zero/all-one outcomes; they do not imply zero population uncertainty. New intervals use a different method/RNG from the retained frozen intervals and are labeled separately.

### L1 overall and per-type intervals

| Group | Eligible n | Small sample | Hit@5 | Wilson 95% CI | Coverage@5 | Bootstrap 95% CI |
| --- | --- | --- | --- | --- | --- | --- |
| overall | 184 | No | 0.777174 | [0.711726, 0.831286] | 0.830616 | [0.778986, 0.879529] |
| comparison | 20 | No | 0.900000 | [0.698966, 0.972134] | 0.933333 | [0.816667, 1.000000] |
| cross_document | 20 | No | 0.350000 | [0.181192, 0.567146] | 0.625000 | [0.483333, 0.766667] |
| explanation | 32 | No | 0.937500 | [0.798529, 0.982689] | 0.937500 | [0.843750, 1.000000] |
| fact_definition | 40 | No | 0.825000 | [0.680500, 0.912546] | 0.825000 | [0.700000, 0.925000] |
| list_enumeration | 20 | No | 0.900000 | [0.698966, 0.972134] | 0.900000 | [0.750000, 1.000000] |
| multi_chunk_same_doc | 16 | SMALL-SAMPLE | 0.625000 | [0.386410, 0.815188] | 0.791667 | [0.635417, 0.927083] |
| realistic_student | 16 | SMALL-SAMPLE | 0.750000 | [0.505017, 0.898179] | 0.781250 | [0.562500, 0.937500] |
| table_diagram_code | 20 | No | 0.750000 | [0.531299, 0.888138] | 0.775000 | [0.600000, 0.950000] |
| unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | N/A | N/A | N/A |

### L2 overall and per-type intervals

| Group | Eligible n | Small sample | Hit@5 | Wilson 95% CI | Coverage@5 | Bootstrap 95% CI |
| --- | --- | --- | --- | --- | --- | --- |
| overall | 184 | No | 0.793478 | [0.729276, 0.845677] | 0.854348 | [0.807971, 0.896920] |
| comparison | 20 | No | 0.750000 | [0.531299, 0.888138] | 0.850000 | [0.716667, 0.966667] |
| cross_document | 20 | No | 0.400000 | [0.218807, 0.613418] | 0.658333 | [0.516667, 0.800000] |
| explanation | 32 | No | 0.906250 | [0.757818, 0.967598] | 0.921875 | [0.828125, 1.000000] |
| fact_definition | 40 | No | 0.950000 | [0.834961, 0.986179] | 0.950000 | [0.875000, 1.000000] |
| list_enumeration | 20 | No | 0.900000 | [0.698966, 0.972134] | 0.900000 | [0.750000, 1.000000] |
| multi_chunk_same_doc | 16 | SMALL-SAMPLE | 0.687500 | [0.444044, 0.858354] | 0.793750 | [0.625000, 0.937500] |
| realistic_student | 16 | SMALL-SAMPLE | 0.812500 | [0.569911, 0.934084] | 0.843750 | [0.656250, 1.000000] |
| table_diagram_code | 20 | No | 0.700000 | [0.481027, 0.854523] | 0.766667 | [0.583333, 0.933333] |
| unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | N/A | N/A | N/A |

### L3 overall and per-type intervals

| Group | Eligible n | Small sample | Hit@5 | Wilson 95% CI | Coverage@5 | Bootstrap 95% CI |
| --- | --- | --- | --- | --- | --- | --- |
| overall | 184 | No | 0.826087 | [0.764806, 0.874031] | 0.888134 | [0.846920, 0.925725] |
| comparison | 20 | No | 0.800000 | [0.583983, 0.919342] | 0.925000 | [0.858125, 0.983333] |
| cross_document | 20 | No | 0.600000 | [0.386582, 0.781193] | 0.816667 | [0.716667, 0.908333] |
| explanation | 32 | No | 0.937500 | [0.798529, 0.982689] | 0.937500 | [0.843750, 1.000000] |
| fact_definition | 40 | No | 1.000000 | [0.912378, 1.000000] | 1.000000 | [1.000000, 1.000000] |
| list_enumeration | 20 | No | 0.900000 | [0.698966, 0.972134] | 0.925000 | [0.800000, 1.000000] |
| multi_chunk_same_doc | 16 | SMALL-SAMPLE | 0.562500 | [0.331786, 0.769013] | 0.713542 | [0.515625, 0.890625] |
| realistic_student | 16 | SMALL-SAMPLE | 0.937500 | [0.716713, 0.988881] | 0.937500 | [0.812500, 1.000000] |
| table_diagram_code | 20 | No | 0.600000 | [0.386582, 0.781193] | 0.683333 | [0.500000, 0.850000] |
| unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | N/A | N/A | N/A |

### Paired Hit@5 comparisons: overall and every question type

| Difference | Group | n | Small sample | Hit difference | Improved | Worsened | Unchanged | Exact McNemar p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L2 minus L1 | overall | 184 | No | 0.016304 | 23 | 20 | 141 | 0.760792 | Not distinguishable |
| L3 minus L2 | overall | 184 | No | 0.032609 | 17 | 11 | 156 | 0.344928 | Not distinguishable |
| L3 minus L1 | overall | 184 | No | 0.048913 | 28 | 19 | 137 | 0.242960 | Not distinguishable |
| L2 minus L1 | comparison | 20 | No | -0.150000 | 2 | 5 | 13 | 0.453125 | Not distinguishable |
| L3 minus L2 | comparison | 20 | No | 0.050000 | 2 | 1 | 17 | 1.000000 | Not distinguishable |
| L3 minus L1 | comparison | 20 | No | -0.100000 | 1 | 3 | 16 | 0.625000 | Not distinguishable |
| L2 minus L1 | cross_document | 20 | No | 0.050000 | 3 | 2 | 15 | 1.000000 | Not distinguishable |
| L3 minus L2 | cross_document | 20 | No | 0.200000 | 6 | 2 | 12 | 0.289062 | Not distinguishable |
| L3 minus L1 | cross_document | 20 | No | 0.250000 | 6 | 1 | 13 | 0.125000 | Not distinguishable |
| L2 minus L1 | explanation | 32 | No | -0.031250 | 2 | 3 | 27 | 1.000000 | Not distinguishable |
| L3 minus L2 | explanation | 32 | No | 0.031250 | 1 | 0 | 31 | 1.000000 | Not distinguishable |
| L3 minus L1 | explanation | 32 | No | 0.000000 | 2 | 2 | 28 | 1.000000 | Not distinguishable |
| L2 minus L1 | fact_definition | 40 | No | 0.125000 | 5 | 0 | 35 | 0.062500 | Not distinguishable |
| L3 minus L2 | fact_definition | 40 | No | 0.050000 | 2 | 0 | 38 | 0.500000 | Not distinguishable |
| L3 minus L1 | fact_definition | 40 | No | 0.175000 | 7 | 0 | 33 | 0.015625 | Distinguishable (nominal) |
| L2 minus L1 | list_enumeration | 20 | No | 0.000000 | 2 | 2 | 16 | 1.000000 | Not distinguishable |
| L3 minus L2 | list_enumeration | 20 | No | 0.000000 | 0 | 0 | 20 | 1.000000 | Not distinguishable |
| L3 minus L1 | list_enumeration | 20 | No | 0.000000 | 2 | 2 | 16 | 1.000000 | Not distinguishable |
| L2 minus L1 | multi_chunk_same_doc | 16 | SMALL-SAMPLE | 0.062500 | 4 | 3 | 9 | 1.000000 | Not distinguishable |
| L3 minus L2 | multi_chunk_same_doc | 16 | SMALL-SAMPLE | -0.125000 | 2 | 4 | 10 | 0.687500 | Not distinguishable |
| L3 minus L1 | multi_chunk_same_doc | 16 | SMALL-SAMPLE | -0.062500 | 3 | 4 | 9 | 1.000000 | Not distinguishable |
| L2 minus L1 | realistic_student | 16 | SMALL-SAMPLE | 0.062500 | 2 | 1 | 13 | 1.000000 | Not distinguishable |
| L3 minus L2 | realistic_student | 16 | SMALL-SAMPLE | 0.125000 | 2 | 0 | 14 | 0.500000 | Not distinguishable |
| L3 minus L1 | realistic_student | 16 | SMALL-SAMPLE | 0.187500 | 4 | 1 | 11 | 0.375000 | Not distinguishable |
| L2 minus L1 | table_diagram_code | 20 | No | -0.050000 | 3 | 4 | 13 | 1.000000 | Not distinguishable |
| L3 minus L2 | table_diagram_code | 20 | No | -0.100000 | 2 | 4 | 14 | 0.687500 | Not distinguishable |
| L3 minus L1 | table_diagram_code | 20 | No | -0.150000 | 3 | 6 | 11 | 0.507812 | Not distinguishable |
| L2 minus L1 | unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | 0 | 0 | 0 | N/A | N/A |
| L3 minus L2 | unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | 0 | 0 | 0 | N/A | N/A |
| L3 minus L1 | unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | 0 | 0 | 0 | N/A | N/A |

### Paired evidence coverage@5 comparisons: overall and every question type

| Difference | Group | n | Small sample | Coverage difference | Improved | Worsened | Unchanged | Paired bootstrap 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L2 minus L1 | overall | 184 | No | 0.023732 | 25 | 21 | 138 | [-0.034964, 0.081522] | Not distinguishable |
| L3 minus L2 | overall | 184 | No | 0.033786 | 22 | 14 | 148 | [-0.007704, 0.075546] | Not distinguishable |
| L3 minus L1 | overall | 184 | No | 0.057518 | 32 | 19 | 133 | [-0.001812, 0.118659] | Not distinguishable |
| L2 minus L1 | comparison | 20 | No | -0.083333 | 2 | 5 | 13 | [-0.250000, 0.091667] | Not distinguishable |
| L3 minus L2 | comparison | 20 | No | 0.075000 | 3 | 1 | 16 | [-0.025000, 0.200000] | Not distinguishable |
| L3 minus L1 | comparison | 20 | No | -0.008333 | 1 | 3 | 16 | [-0.108333, 0.125000] | Not distinguishable |
| L2 minus L1 | cross_document | 20 | No | 0.033333 | 4 | 3 | 13 | [-0.100000, 0.166667] | Not distinguishable |
| L3 minus L2 | cross_document | 20 | No | 0.158333 | 8 | 2 | 10 | [0.008333, 0.300000] | Distinguishable (nominal) |
| L3 minus L1 | cross_document | 20 | No | 0.191667 | 8 | 1 | 11 | [0.050000, 0.325000] | Distinguishable (nominal) |
| L2 minus L1 | explanation | 32 | No | -0.015625 | 2 | 3 | 27 | [-0.140625, 0.109375] | Not distinguishable |
| L3 minus L2 | explanation | 32 | No | 0.015625 | 1 | 0 | 31 | [0.000000, 0.046875] | Not distinguishable |
| L3 minus L1 | explanation | 32 | No | 0.000000 | 2 | 2 | 28 | [-0.125000, 0.125000] | Not distinguishable |
| L2 minus L1 | fact_definition | 40 | No | 0.125000 | 5 | 0 | 35 | [0.025000, 0.225000] | Distinguishable (nominal) |
| L3 minus L2 | fact_definition | 40 | No | 0.050000 | 2 | 0 | 38 | [0.000000, 0.125000] | Not distinguishable |
| L3 minus L1 | fact_definition | 40 | No | 0.175000 | 7 | 0 | 33 | [0.075000, 0.300000] | Distinguishable (nominal) |
| L2 minus L1 | list_enumeration | 20 | No | 0.000000 | 2 | 2 | 16 | [-0.200000, 0.200000] | Not distinguishable |
| L3 minus L2 | list_enumeration | 20 | No | 0.025000 | 1 | 0 | 19 | [0.000000, 0.075000] | Not distinguishable |
| L3 minus L1 | list_enumeration | 20 | No | 0.025000 | 2 | 2 | 16 | [-0.150000, 0.200000] | Not distinguishable |
| L2 minus L1 | multi_chunk_same_doc | 16 | SMALL-SAMPLE | 0.002083 | 4 | 3 | 9 | [-0.181250, 0.168750] | Not distinguishable |
| L3 minus L2 | multi_chunk_same_doc | 16 | SMALL-SAMPLE | -0.080208 | 2 | 5 | 9 | [-0.256250, 0.081250] | Not distinguishable |
| L3 minus L1 | multi_chunk_same_doc | 16 | SMALL-SAMPLE | -0.078125 | 4 | 4 | 8 | [-0.302083, 0.114583] | Not distinguishable |
| L2 minus L1 | realistic_student | 16 | SMALL-SAMPLE | 0.062500 | 2 | 1 | 13 | [-0.125000, 0.250000] | Not distinguishable |
| L3 minus L2 | realistic_student | 16 | SMALL-SAMPLE | 0.093750 | 2 | 0 | 14 | [0.000000, 0.250000] | Not distinguishable |
| L3 minus L1 | realistic_student | 16 | SMALL-SAMPLE | 0.156250 | 4 | 1 | 11 | [-0.062500, 0.406250] | Not distinguishable |
| L2 minus L1 | table_diagram_code | 20 | No | -0.008333 | 4 | 4 | 12 | [-0.250000, 0.225000] | Not distinguishable |
| L3 minus L2 | table_diagram_code | 20 | No | -0.083333 | 3 | 6 | 11 | [-0.316667, 0.150000] | Not distinguishable |
| L3 minus L1 | table_diagram_code | 20 | No | -0.091667 | 4 | 6 | 10 | [-0.333333, 0.150000] | Not distinguishable |
| L2 minus L1 | unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | 0 | 0 | 0 | N/A | N/A |
| L3 minus L2 | unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | 0 | 0 | 0 | N/A | N/A |
| L3 minus L1 | unanswerable | 0 | SMALL-SAMPLE; N/A | N/A | 0 | 0 | 0 | N/A | N/A |
