# L1 final retrieval results

Page-text PDF parsing; token windows up to 400 with overlap 40; normalized BGE-small dense embeddings; exact FAISS inner-product retrieval; no reranker.

The selected frozen evaluation switches query processing off, although the shipped application supports default-on processing. Rewriting, retries and generation are excluded from this measurement.

Questions: 200 total, 184 answerable, 16 excluded from quality.

| Metric | Value | Frozen 95% interval |
| --- | --- | --- |
| hit@1 | 0.461957 | [0.391304, 0.532609] |
| hit@3 | 0.684783 | [0.619565, 0.750000] |
| hit@5 | 0.777174 | [0.717391, 0.836957] |
| hit@10 | 0.880435 | [0.831522, 0.923913] |
| mrr@5 | 0.720562 | [0.665759, 0.775093] |
| recall@5 | 0.837552 | [0.788768, 0.883752] |
| location_hit@5 | 0.798913 | Not available |
| Evidence coverage@5 | 0.830616 | New interval below |

## By question type

| Group | Total n | Answerable n | Hit@1 | Hit@3 | Hit@5 | MRR@5 | Recall@5 | Location Hit@5 | Coverage@5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| comparison | 20 | 20 | 0.450000 | 0.800000 | 0.900000 | 0.754167 | 0.933333 | 0.900000 | 0.933333 |
| cross_document | 20 | 20 | 0.000000 | 0.100000 | 0.350000 | 0.610000 | 0.630476 | 0.350000 | 0.625000 |
| explanation | 32 | 32 | 0.625000 | 0.906250 | 0.937500 | 0.783854 | 0.937500 | 0.937500 | 0.937500 |
| fact_definition | 40 | 40 | 0.625000 | 0.775000 | 0.825000 | 0.694583 | 0.841667 | 0.850000 | 0.825000 |
| list_enumeration | 20 | 20 | 0.700000 | 0.900000 | 0.900000 | 0.791667 | 0.900000 | 0.900000 | 0.900000 |
| multi_chunk_same_doc | 16 | 16 | 0.000000 | 0.500000 | 0.625000 | 0.875000 | 0.806548 | 0.687500 | 0.791667 |
| realistic_student | 16 | 16 | 0.375000 | 0.500000 | 0.750000 | 0.556250 | 0.781250 | 0.750000 | 0.781250 |
| table_diagram_code | 20 | 20 | 0.550000 | 0.700000 | 0.750000 | 0.685000 | 0.788095 | 0.850000 | 0.775000 |
| unanswerable | 16 | 0 | N/A | N/A | N/A | N/A | N/A | N/A | N/A |


## By neutral subject

| Group | Total n | Answerable n | Hit@1 | Hit@3 | Hit@5 | MRR@5 | Recall@5 | Location Hit@5 | Coverage@5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Subject A | 50 | 46 | 0.434783 | 0.673913 | 0.782609 | 0.688406 | 0.824534 | 0.804348 | 0.818841 |
| Subject B | 50 | 46 | 0.456522 | 0.695652 | 0.739130 | 0.692754 | 0.807246 | 0.739130 | 0.807971 |
| Subject C | 50 | 46 | 0.391304 | 0.652174 | 0.760870 | 0.705072 | 0.840062 | 0.782609 | 0.836957 |
| Subject D | 50 | 46 | 0.565217 | 0.717391 | 0.826087 | 0.796014 | 0.878364 | 0.869565 | 0.858696 |


## All saved cutoff and context statistics

| k | Hit | Keyword Recall | MRR | Location Hit | Mean context tokens | Mean returned contexts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.461957 | 0.553698 | 0.614130 | 0.494565 | 245.590000 | 1.000000 |
| 3 | 0.684783 | 0.759722 | 0.705616 | 0.717391 | 718.345000 | 3.000000 |
| 5 | 0.777174 | 0.837552 | 0.720562 | 0.798913 | 1187.600000 | 5.000000 |
| 10 | 0.880435 | 0.913561 | 0.727978 | 0.896739 | 2385.005000 | 10.000000 |

Quality means use 184 answerable questions; context averages include all 200. Stored mean local query seconds from this quality pass: 0.015605. This inherited descriptive timing is not a new latency benchmark or deployment guarantee. Actual context tokens sent to an answer model: zero.

## Failure counts

| Cause | All answerable failures | Failed target types only |
| --- | --- | --- |
| parsing/extraction | 0 | 0 |
| chunk boundary | 4 | 2 |
| candidate retrieval | 0 | 0 |
| reranking | 0 | 0 |
| parent selection | 0 | 0 |
| UNDETERMINED | 37 | 22 |

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

### Overall paired comparisons involving this level

| Difference | Group | n | Small sample | Hit difference | Improved | Worsened | Unchanged | Exact McNemar p | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L2 minus L1 | overall | 184 | No | 0.016304 | 23 | 20 | 141 | 0.760792 | Not distinguishable |
| L3 minus L1 | overall | 184 | No | 0.048913 | 28 | 19 | 137 | 0.242960 | Not distinguishable |

| Difference | Group | n | Small sample | Coverage difference | Improved | Worsened | Unchanged | Paired bootstrap 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L2 minus L1 | overall | 184 | No | 0.023732 | 25 | 21 | 138 | [-0.034964, 0.081522] | Not distinguishable |
| L3 minus L1 | overall | 184 | No | 0.057518 | 32 | 19 | 133 | [-0.001812, 0.118659] | Not distinguishable |

All per-type paired counts, tests and intervals are in comparison_table.md; the complete machine-readable addendum is in final_results.json.
