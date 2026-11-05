# Key findings

L3 has the highest observed overall Hit@5: 0.826087, compared with L2 0.793478 and L1 0.777174. Evidence coverage@5 is 0.888134, 0.854348 and 0.830616 respectively. L3 is the strongest observed overall configuration on these saved records; its Hit@5 lead is not distinguishable under the retained paired intervals.

## What each level adds

L1 provides the dense page-chunk baseline. L2 adds Markdown/OCR parsing, heading-aware chunks and dense/BM25 fusion. Relative to L1, Hit@5 rises by 0.016304 and coverage@5 by 0.023732. Hit@1 is slightly lower, so L2 does not improve every cutoff.

L3 adds structured parsing, dense/learned-sparse retrieval, child reranking and returned parents with a different existing snapshot. Relative to L2, Hit@5 rises by 0.032609 and coverage@5 by 0.033786. Retained paired intervals for L3 MRR@5 and keyword Recall@5 against L1/L2 are positive; the Recall comparison against L2 is borderline. Several features change together, so no individual component benefit is established.

## Type-level tradeoffs

| Question type | n | L1 coverage@5 | L2 coverage@5 | L3 coverage@5 |
| --- | --- | --- | --- | --- |
| cross_document | 20 | 0.625000 | 0.658333 | 0.816667 |
| multi_chunk_same_doc | 16 | 0.791667 | 0.793750 | 0.713542 |
| table_diagram_code | 20 | 0.775000 | 0.766667 | 0.683333 |

L3 improves cross-document evidence coverage while same-document multipart and table/diagram/code coverage are lower than both earlier levels. A higher overall mean does not imply improvement on every type. New intervals for these type-level coverage differences appear in the significance addendum; nominal findings are exploratory.

## Supported failure findings

The three target types contain 70 failed level/question pairs: 11 SPLIT/CHUNK_MISS bucket assignments and 59 UNDETERMINED. The saved fields do not isolate candidate retrieval, reranking, extraction or parent selection. CHUNK_MISS is not proof of a parser defect. All proposed pipeline fixes remain future work.

## Metric caveat

Both multipart types have Hit@1 = 0 at every level. Cross-document zero is structural: one returned context has one document identity but the gold requires entries from distinct documents. Same-document zero is influenced by the all-evidence rule but is not universally forced, because a parent can span pages. Of 16 same-document questions, a single saved returned context has metadata covering every required location for 0, 0 and 1 questions in L1, L2 and L3 respectively. The L3 case still fails keyword completeness; a deeper cause cannot be decided. This checks returned contexts, not all possible indexed parents.

Evidence coverage gives partial credit to complete required entries while preserving the existing lexical matching rule. See failure_analysis.md for details.

## Sample sizes

| Question type | Answerable n | Total n |
| --- | --- | --- |
| comparison | 20 | 20 |
| cross_document | 20 | 20 |
| explanation | 32 | 32 |
| fact_definition | 40 | 40 |
| list_enumeration | 20 | 20 |
| multi_chunk_same_doc | 16 | 16 |
| realistic_student | 16 | 16 |
| table_diagram_code | 20 | 20 |
| unanswerable | 0 | 16 |


## Limitations

One dataset, four neutral subjects, 37 documents, 200 questions: 184 answerable and 16 unanswerable. Quality averages exclude unanswerables. Answerable type samples have only 16–40 questions, with 4–10 per subject. This package evaluates saved retrieval, not generated answers or deployment performance. New coverage intervals and paired comparisons appear in the significance addendum; type-level findings use nominal, unadjusted thresholds. Several components change together, so these results cannot isolate a component’s causal contribution.

The frozen headline evaluates processing off although the shipped application can enable it by default. No current default-on quality run was performed. Supplied question-type annotations were retained without an independent annotation audit.

## Verification

The 3 selected input hashes and all 17 frozen quality means match the saved per-question derivations within 1e-12. Across 616 saved group/cutoff checks, 572 numeric values agree. The other 44 are disclosed empty-group representation differences: saved unanswerable-only summaries use zero; this package uses N/A, JSON null or an empty CSV score. These zeros are not observed retrieval failures. No numeric mismatch was silently resolved.

## Significance addendum

No overall level difference is statistically distinguishable for either Hit@5 or evidence coverage@5 under the new specified tests. All three overall McNemar p-values exceed 0.05, and all three paired coverage intervals include zero. The observed overall gains are compatible with sampling noise; this does not establish equal performance.

| Difference | Hit@5 p | Coverage difference | Paired coverage 95% CI |
| --- | --- | --- | --- |
| L2 minus L1 | 0.760792 | 0.023732 | [-0.034964, 0.081522] |
| L3 minus L2 | 0.344928 | 0.033786 | [-0.007704, 0.075546] |
| L3 minus L1 | 0.242960 | 0.057518 | [-0.001812, 0.118659] |

The only nominally distinguishable type-level differences are listed below. Each favors the right-hand level. Every other measured type/metric comparison is not distinguishable under its specified test and is compatible with sampling noise. No inference is made for unanswerable questions.

| Difference | Question type | Metric | n | Nominal evidence |
| --- | --- | --- | --- | --- |
| L3 minus L2 | cross_document | Evidence coverage@5 | 20 | [0.008333, 0.300000] |
| L3 minus L1 | cross_document | Evidence coverage@5 | 20 | [0.050000, 0.325000] |
| L2 minus L1 | fact_definition | Evidence coverage@5 | 40 | [0.025000, 0.225000] |
| L3 minus L1 | fact_definition | Hit@5 | 40 | p=0.015625 |
| L3 minus L1 | fact_definition | Evidence coverage@5 | 40 | [0.075000, 0.300000] |

These findings are exploratory because the repeated comparisons are unadjusted. In fact_definition, L2 versus L1 coverage clears the percentile-bootstrap threshold while the identical binary Hit outcomes do not clear exact McNemar (p=0.0625); different inference methods can disagree with few discordant pairs. Neither result should be substituted for the other. Small-sample types are multi_chunk_same_doc and realistic_student (16 answerable questions each); no pairwise difference in those types clears the specified thresholds. Prior retained MRR/keyword-Recall findings refer to different metrics and do not establish significance for evidence-entry coverage.

New saved-record inference: Hit@5 uses two-sided Wilson score 95% intervals. Coverage means and right-minus-left paired coverage differences use 10,000 question bootstrap resamples, standard-library random.Random seed 42 reset for every estimate, and linearly interpolated 2.5th/97.5th percentiles at (B−1)p. Questions are ordered by neutral ID. Paired resampling uses the same question on both levels. Improved/worsened/unchanged counts are computed separately for each metric; positive means the right level is better. Exact two-sided McNemar tests condition on discordant Hit pairs, double the smaller Binomial(n, 0.5) tail and cap at one; no mid-p correction. With no discordant pairs p=1; with no eligible questions all inference is N/A.

Distinguishable means McNemar p < 0.05 for Hit, or a paired coverage interval excluding zero. These are nominal, unadjusted comparisons; type findings are exploratory. Fewer than 20 eligible answerable questions is SMALL-SAMPLE: multi_chunk_same_doc and realistic_student each have 16. The unanswerable type has zero eligible observations. This is question-level inference for a fixed dataset, without subject/document cluster adjustment. A non-distinguishable result is compatible with sampling noise, not proof of equality. Empirical bootstrap intervals can be degenerate at all-zero/all-one outcomes; they do not imply zero population uncertainty. New intervals use a different method/RNG from the retained frozen intervals and are labeled separately.
