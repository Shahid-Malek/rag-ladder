# L2 final retrieval results

Page Markdown with selective local OCR; heading-aware chunks up to 400 and zero overlap; normalized BGE-base embeddings; exact pgvector dense 20 plus BM25 20; reciprocal-rank fusion with constant 60; no reranker.

The selected frozen evaluation switches query processing off, although the shipped application supports default-on processing. Rewriting, retries and generation are excluded from this measurement.

Questions: 200 total, 184 answerable, 16 excluded from quality.

| Metric | Value | Frozen 95% interval |
| --- | --- | --- |
| hit@1 | 0.451087 | [0.380435, 0.521739] |
| hit@3 | 0.711957 | [0.646739, 0.777174] |
| hit@5 | 0.793478 | [0.733696, 0.847826] |
| hit@10 | 0.864130 | [0.815217, 0.913043] |
| mrr@5 | 0.753804 | [0.703080, 0.803354] |
| recall@5 | 0.884261 | [0.844422, 0.920635] |
| location_hit@5 | 0.869565 | Not available |
| Evidence coverage@5 | 0.854348 | New interval below |

## By question type

| Group | Total n | Answerable n | Hit@1 | Hit@3 | Hit@5 | MRR@5 | Recall@5 | Location Hit@5 | Coverage@5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| comparison | 20 | 20 | 0.350000 | 0.650000 | 0.750000 | 0.812500 | 0.863095 | 0.850000 | 0.850000 |
| cross_document | 20 | 20 | 0.000000 | 0.200000 | 0.400000 | 0.625000 | 0.678810 | 0.450000 | 0.658333 |
| explanation | 32 | 32 | 0.593750 | 0.906250 | 0.906250 | 0.770833 | 0.971354 | 1.000000 | 0.921875 |
| fact_definition | 40 | 40 | 0.700000 | 0.900000 | 0.950000 | 0.791667 | 0.950000 | 0.950000 | 0.950000 |
| list_enumeration | 20 | 20 | 0.550000 | 0.850000 | 0.900000 | 0.695833 | 0.900000 | 0.900000 | 0.900000 |
| multi_chunk_same_doc | 16 | 16 | 0.000000 | 0.375000 | 0.687500 | 0.822917 | 0.825298 | 0.812500 | 0.793750 |
| realistic_student | 16 | 16 | 0.562500 | 0.750000 | 0.812500 | 0.731250 | 0.843750 | 0.812500 | 0.843750 |
| table_diagram_code | 20 | 20 | 0.450000 | 0.700000 | 0.700000 | 0.741667 | 0.903889 | 1.000000 | 0.766667 |
| unanswerable | 16 | 0 | N/A | N/A | N/A | N/A | N/A | N/A | N/A |


## By neutral subject

| Group | Total n | Answerable n | Hit@1 | Hit@3 | Hit@5 | MRR@5 | Recall@5 | Location Hit@5 | Coverage@5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Subject A | 50 | 46 | 0.543478 | 0.804348 | 0.847826 | 0.797101 | 0.882505 | 0.869565 | 0.884058 |
| Subject B | 50 | 46 | 0.500000 | 0.782609 | 0.847826 | 0.768116 | 0.922464 | 0.913043 | 0.884783 |
| Subject C | 50 | 46 | 0.326087 | 0.608696 | 0.760870 | 0.687319 | 0.897912 | 0.869565 | 0.847826 |
| Subject D | 50 | 46 | 0.434783 | 0.652174 | 0.717391 | 0.762681 | 0.834161 | 0.826087 | 0.800725 |


## All saved cutoff and context statistics

| k | Hit | Keyword Recall | MRR | Location Hit | Mean context tokens | Mean returned contexts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.451087 | 0.575002 | 0.641304 | 0.554348 | 192.955000 | 1.000000 |
| 3 | 0.711957 | 0.828602 | 0.744565 | 0.798913 | 556.400000 | 3.000000 |
| 5 | 0.793478 | 0.884261 | 0.753804 | 0.869565 | 920.550000 | 5.000000 |
| 10 | 0.864130 | 0.931039 | 0.756936 | 0.940217 | 1765.275000 | 10.000000 |

Quality means use 184 answerable questions; context averages include all 200. Stored mean local query seconds from this quality pass: 0.048434. This inherited descriptive timing is not a new latency benchmark or deployment guarantee. Actual context tokens sent to an answer model: zero.

## Failure counts

| Cause | All answerable failures | Failed target types only |
| --- | --- | --- |
| parsing/extraction | 0 | 0 |
| chunk boundary | 7 | 4 |
| candidate retrieval | 0 | 0 |
| reranking | 0 | 0 |
| parent selection | 0 | 0 |
| UNDETERMINED | 31 | 19 |

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

### Overall paired comparisons involving this level

| Difference | Group | n | Small sample | Hit difference | Improved | Worsened | Unchanged | Exact McNemar p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L2 minus L1 | overall | 184 | No | 0.016304 | 23 | 20 | 141 | 0.760792 | Not distinguishable |
| L3 minus L2 | overall | 184 | No | 0.032609 | 17 | 11 | 156 | 0.344928 | Not distinguishable |

| Difference | Group | n | Small sample | Coverage difference | Improved | Worsened | Unchanged | Paired bootstrap 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L2 minus L1 | overall | 184 | No | 0.023732 | 25 | 21 | 138 | [-0.034964, 0.081522] | Not distinguishable |
| L3 minus L2 | overall | 184 | No | 0.033786 | 22 | 14 | 148 | [-0.007704, 0.075546] | Not distinguishable |

All per-type paired counts, tests and intervals are in comparison_table.md; the complete machine-readable addendum is in final_results.json.
