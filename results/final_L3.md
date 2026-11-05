# L3 final retrieval results

Docling with local OCR and table parsing; HybridChunker children up to 400 and same-heading parents up to 1500; BGE-M3 dense plus learned sparse; dense 20 and sparse 20 fused with constant 60; top 20 children scored by BGE reranker with sigmoid; at most five distinct parents. The existing snapshot includes cached captions.

The selected frozen evaluation switches query processing off, although the shipped application supports default-on processing. Rewriting, retries and generation are excluded from this measurement.

Questions: 200 total, 184 answerable, 16 excluded from quality.

| Metric | Value | Frozen 95% interval |
| --- | --- | --- |
| hit@1 | 0.597826 | [0.527174, 0.668478] |
| hit@3 | 0.777174 | [0.717391, 0.836957] |
| hit@5 | 0.826087 | [0.771739, 0.880435] |
| hit@10 | N/A | Not available |
| mrr@5 | 0.865580 | [0.820740, 0.907518] |
| recall@5 | 0.918754 | [0.887371, 0.947390] |
| location_hit@5 | 0.907609 | Not available |
| Evidence coverage@5 | 0.888134 | New interval below |

## By question type

| Group | Total n | Answerable n | Hit@1 | Hit@3 | Hit@5 | MRR@5 | Recall@5 | Location Hit@5 | Coverage@5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| comparison | 20 | 20 | 0.500000 | 0.700000 | 0.800000 | 0.908333 | 0.947222 | 0.900000 | 0.925000 |
| cross_document | 20 | 20 | 0.000000 | 0.450000 | 0.600000 | 0.854167 | 0.820238 | 0.600000 | 0.816667 |
| explanation | 32 | 32 | 0.812500 | 0.906250 | 0.937500 | 0.881250 | 0.960938 | 0.968750 | 0.937500 |
| fact_definition | 40 | 40 | 0.875000 | 1.000000 | 1.000000 | 0.937500 | 1.000000 | 1.000000 | 1.000000 |
| list_enumeration | 20 | 20 | 0.800000 | 0.850000 | 0.900000 | 0.885000 | 0.935714 | 0.950000 | 0.925000 |
| multi_chunk_same_doc | 16 | 16 | 0.000000 | 0.500000 | 0.562500 | 0.731250 | 0.750939 | 0.750000 | 0.713542 |
| realistic_student | 16 | 16 | 0.812500 | 0.875000 | 0.937500 | 0.848958 | 0.937500 | 0.937500 | 0.937500 |
| table_diagram_code | 20 | 20 | 0.500000 | 0.600000 | 0.600000 | 0.766667 | 0.861111 | 1.000000 | 0.683333 |
| unanswerable | 16 | 0 | N/A | N/A | N/A | N/A | N/A | N/A | N/A |


## By neutral subject

| Group | Total n | Answerable n | Hit@1 | Hit@3 | Hit@5 | MRR@5 | Recall@5 | Location Hit@5 | Coverage@5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Subject A | 50 | 46 | 0.717391 | 0.891304 | 0.913043 | 0.942029 | 0.956522 | 0.934783 | 0.949275 |
| Subject B | 50 | 46 | 0.695652 | 0.826087 | 0.869565 | 0.865942 | 0.943701 | 0.913043 | 0.898551 |
| Subject C | 50 | 46 | 0.434783 | 0.717391 | 0.782609 | 0.828623 | 0.915752 | 0.913043 | 0.865942 |
| Subject D | 50 | 46 | 0.543478 | 0.673913 | 0.739130 | 0.825725 | 0.859041 | 0.869565 | 0.838768 |


## All saved cutoff and context statistics

| k | Hit | Keyword Recall | MRR | Location Hit | Mean context tokens | Mean returned contexts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.597826 | 0.736284 | 0.815217 | 0.684783 | 255.450000 | 1.000000 |
| 3 | 0.777174 | 0.882371 | 0.859601 | 0.880435 | 719.250000 | 3.000000 |
| 5 | 0.826087 | 0.918754 | 0.865580 | 0.907609 | 1212.685000 | 5.000000 |

Quality means use 184 answerable questions; context averages include all 200. Stored mean local query seconds from this quality pass: 1.886351. This inherited descriptive timing is not a new latency benchmark or deployment guarantee. Actual context tokens sent to an answer model: zero.

## Failure counts

| Cause | All answerable failures | Failed target types only |
| --- | --- | --- |
| parsing/extraction | 0 | 0 |
| chunk boundary | 7 | 5 |
| candidate retrieval | 0 | 0 |
| reranking | 0 | 0 |
| parent selection | 0 | 0 |
| UNDETERMINED | 25 | 18 |

Target types are cross_document, multi_chunk_same_doc and table_diagram_code. Zero indicates no confirmed assignment, not that a cause is absent. RANK_MISS is UNDETERMINED. SPLIT/CHUNK_MISS enter the requested chunk boundary bucket, retaining their original codes; CHUNK_MISS alone does not prove an extraction defect or literal boundary error.

## Definitions

`location_hit@5` checks that the first five results contain all required evidence locations, matching the subject, exact document and at least one annotated physical page per evidence entry (any one acceptable alternative suffices for `any_of`), without checking the text.

## Verification

The 3 selected input hashes and all 17 frozen quality means match the saved per-question derivations within 1e-12. Across 616 saved group/cutoff checks, 572 numeric values agree. The other 44 are disclosed empty-group representation differences: saved unanswerable-only summaries use zero; this package uses N/A, JSON null or an empty CSV score. These zeros are not observed retrieval failures. No numeric mismatch was silently resolved.

## Limits

One dataset, four neutral subjects, 37 documents, 200 questions: 184 answerable and 16 unanswerable. Quality averages exclude unanswerables. Answerable type samples have only 16–40 questions, with 4–10 per subject. This package evaluates saved retrieval, not generated answers or deployment performance. New coverage intervals and paired comparisons appear in the significance addendum; type-level findings use nominal, unadjusted thresholds. Several components change together, so these results cannot isolate a component’s causal contribution.

## Significance addendum

New saved-record inference: Hit@5 uses two-sided Wilson score 95% intervals. Coverage means and right-minus-left paired coverage differences use 10,000 question bootstrap resamples, standard-library random.Random seed 42 reset for every estimate, and linearly interpolated 2.5th/97.5th percentiles at (B−1)p. Questions are ordered by neutral ID. Paired resampling uses the same question on both levels. Improved/worsened/unchanged counts are computed separately for each metric; positive means the right level is better. Exact two-sided McNemar tests condition on discordant Hit pairs, double the smaller Binomial(n, 0.5) tail and cap at one; no mid-p correction. With no discordant pairs p=1; with no eligible questions all inference is N/A.

Distinguishable means McNemar p < 0.05 for Hit, or a paired coverage interval excluding zero. These are nominal, unadjusted comparisons; type findings are exploratory. Fewer than 20 eligible answerable questions is SMALL-SAMPLE: multi_chunk_same_doc and realistic_student each have 16. The unanswerable type has zero eligible observations. This is question-level inference for a fixed dataset, without subject/document cluster adjustment. A non-distinguishable result is compatible with sampling noise, not proof of equality. Empirical bootstrap intervals can be degenerate at all-zero/all-one outcomes; they do not imply zero population uncertainty. New intervals use a different method/RNG from the retained frozen intervals and are labeled separately.

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

### Overall paired comparisons involving this level

| Difference | Group | n | Small sample | Hit difference | Improved | Worsened | Unchanged | Exact McNemar p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L3 minus L2 | overall | 184 | No | 0.032609 | 17 | 11 | 156 | 0.344928 | Not distinguishable |
| L3 minus L1 | overall | 184 | No | 0.048913 | 28 | 19 | 137 | 0.242960 | Not distinguishable |

| Difference | Group | n | Small sample | Coverage difference | Improved | Worsened | Unchanged | Paired bootstrap 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L3 minus L2 | overall | 184 | No | 0.033786 | 22 | 14 | 148 | [-0.007704, 0.075546] | Not distinguishable |
| L3 minus L1 | overall | 184 | No | 0.057518 | 32 | 19 | 133 | [-0.001812, 0.118659] | Not distinguishable |

All per-type paired counts, tests and intervals are in comparison_table.md; the complete machine-readable addendum is in final_results.json.
