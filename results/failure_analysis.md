# Failure analysis

Every failed Hit@5 question in the three requested types is counted once per level. UNDETERMINED is a disjoint assignment when the saved fields cannot decide. Repeated questions across levels count as separate failure instances.

| Level | Type | Answerable n | Failed@5 | parsing/extraction | chunk boundary | candidate retrieval | reranking | parent selection | UNDETERMINED |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | cross_document | 20 | 13 | 0 | 0 | 0 | 0 | 0 | 13 |
| L1 | multi_chunk_same_doc | 16 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |
| L1 | table_diagram_code | 20 | 5 | 0 | 2 | 0 | 0 | 0 | 3 |
| L2 | cross_document | 20 | 12 | 0 | 1 | 0 | 0 | 0 | 11 |
| L2 | multi_chunk_same_doc | 16 | 5 | 0 | 0 | 0 | 0 | 0 | 5 |
| L2 | table_diagram_code | 20 | 6 | 0 | 3 | 0 | 0 | 0 | 3 |
| L3 | cross_document | 20 | 8 | 0 | 0 | 0 | 0 | 0 | 8 |
| L3 | multi_chunk_same_doc | 16 | 7 | 0 | 0 | 0 | 0 | 0 | 7 |
| L3 | table_diagram_code | 20 | 8 | 0 | 5 | 0 | 0 | 0 | 3 |

## Diagnostic interpretation

diagnose (evaluate.py:118) supplies the final saved failure_at_5 codes. RANK_MISS means the index-wide evidence oracle passes but the final five fail. It does not identify whether candidates, fusion, reranking or parent selection lost evidence. Missing saved fields are candidate_union_entry_hits, post_fusion_entry_hits and reranked_child_entry_ranks; L3 also lacks selected_child_to_parent_entry_hits. Historical Stage 1 L3 diagnostics are not transferred to runtime L3.

SPLIT means pooled located keywords are available but at least one required entry is not whole in a single indexed chunk. CHUNK_MISS means even pooled index-wide evidence coverage is incomplete. Both are placed in the requested chunk boundary category; CHUNK_MISS retains unresolved extraction/chunking origins and is not proof of a parser fault.

Target totals: 70 failure instances, 11 chunk boundary assignments and 59 UNDETERMINED. Confirmed parsing/extraction, candidate retrieval, reranking and parent-selection assignments are zero because the required diagnostic evidence is absent; those mechanisms are not ruled out.

## Metric-definition audit

`location_hit@5` checks that the first five results contain all required evidence locations, matching the subject, exact document and at least one annotated physical page per evidence entry (any one acceptable alternative suffices for `any_of`), without checking the text.

Both multipart types have Hit@1 = 0 at every level. Cross-document zero is structural: one returned context has one document identity but the gold requires entries from distinct documents. Same-document zero is influenced by the all-evidence rule but is not universally forced, because a parent can span pages. Of 16 same-document questions, a single saved returned context has metadata covering every required location for 0, 0 and 1 questions in L1, L2 and L3 respectively. The L3 case still fails keyword completeness; a deeper cause cannot be decided. This checks returned contexts, not all possible indexed parents.

## Partial evidence at rank one

| Level | Type | n | Hit@1 | Questions with any complete entry@1 | Single returned context location-feasible |
| --- | --- | --- | --- | --- | --- |
| L1 | cross_document | 20 | 0.000000 | 9 | 0 |
| L1 | multi_chunk_same_doc | 16 | 0.000000 | 13 | 0 |
| L2 | cross_document | 20 | 0.000000 | 9 | 0 |
| L2 | multi_chunk_same_doc | 16 | 0.000000 | 12 | 0 |
| L3 | cross_document | 20 | 0.000000 | 15 | 0 |
| L3 | multi_chunk_same_doc | 16 | 0.000000 | 11 | 1 |


## Fairer evidence coverage@5

| Question type | Answerable n | L1 | L2 | L3 |
| --- | --- | --- | --- | --- |
| comparison | 20 | 0.933333 | 0.850000 | 0.925000 |
| cross_document | 20 | 0.625000 | 0.658333 | 0.816667 |
| explanation | 32 | 0.937500 | 0.921875 | 0.937500 |
| fact_definition | 40 | 0.825000 | 0.950000 | 1.000000 |
| list_enumeration | 20 | 0.900000 | 0.900000 | 0.925000 |
| multi_chunk_same_doc | 16 | 0.791667 | 0.793750 | 0.713542 |
| realistic_student | 16 | 0.781250 | 0.843750 | 0.937500 |
| table_diagram_code | 20 | 0.775000 | 0.766667 | 0.683333 |
| unanswerable | 0 | N/A | N/A | N/A |

Overall: L1 0.830616, L2 0.854348, L3 0.888134. This credits complete evidence pieces while preserving the original Hit rule. It does not resolve split-entry lexical artifacts. New coverage intervals and paired comparisons are available in comparison_table.md.

## Examples: parsing/extraction

No confirmed instances; zero examples available. Three examples cannot be supplied without inventing a cause.

## Examples: chunk boundary

| Neutral ID | Level | Saved diagnosis | One-line pattern |
| --- | --- | --- | --- |
| Q-039 | L1 | CHUNK_MISS | Indexed evidence is incomplete or split under the saved oracle. |
| Q-142 | L1 | CHUNK_MISS | Indexed evidence is incomplete or split under the saved oracle. |
| Q-089 | L2 | SPLIT | Indexed evidence is incomplete or split under the saved oracle. |


## Examples: candidate retrieval

No confirmed instances; zero examples available. Three examples cannot be supplied without inventing a cause.

## Examples: reranking

No confirmed instances; zero examples available. Three examples cannot be supplied without inventing a cause.

## Examples: parent selection

No confirmed instances; zero examples available. Three examples cannot be supplied without inventing a cause.

## Examples: UNDETERMINED

| Neutral ID | Level | Saved diagnosis | One-line pattern |
| --- | --- | --- | --- |
| Q-032 | L1 | RANK_MISS | Index-wide evidence passes; the final five fail; the intermediate loss stage is not recorded. |
| Q-033 | L1 | RANK_MISS | Index-wide evidence passes; the final five fail; the intermediate loss stage is not recorded. |
| Q-034 | L1 | RANK_MISS | Index-wide evidence passes; the final five fail; the intermediate loss stage is not recorded. |


## Conditional fixes

| Cause | Likely next step if confirmed | Status |
| --- | --- | --- |
| parsing/extraction | If confirmed later, inspect page-to-chunk preservation and repair the responsible parser/OCR step. | Unconfirmed; future work |
| chunk boundary | Test evidence-preserving grouping or overlap for SPLIT; first separate extraction loss from omitted chunks for CHUNK_MISS. | Proposed fixes untested; future work |
| candidate retrieval | Save per-entry dense/sparse candidate oracles before testing broader coverage for confirmed candidate misses. | Unconfirmed; future work |
| reranking | Save entry ranks before/after reranking; test changes only after candidate presence is established. | Unconfirmed; future work |
| parent selection | Save child-to-parent entry coverage and deduplication choices before testing mapping or parent budgets. | Unconfirmed; future work |
| UNDETERMINED | Retain candidate-union, post-fusion, child-ranking and selected-parent evidence diagnostics in a separately authorized run. | Diagnostic work needed; future work |


## Verification

The 3 selected input hashes and all 17 frozen quality means match the saved per-question derivations within 1e-12. Across 616 saved group/cutoff checks, 572 numeric values agree. The other 44 are disclosed empty-group representation differences: saved unanswerable-only summaries use zero; this package uses N/A, JSON null or an empty CSV score. These zeros are not observed retrieval failures. No numeric mismatch was silently resolved.

## Limits

One dataset, four neutral subjects, 37 documents, 200 questions: 184 answerable and 16 unanswerable. Quality averages exclude unanswerables. Answerable type samples have only 16–40 questions, with 4–10 per subject. This package evaluates saved retrieval, not generated answers or deployment performance. New coverage intervals and paired comparisons appear in the significance addendum; type-level findings use nominal, unadjusted thresholds. Several components change together, so these results cannot isolate a component’s causal contribution.

## Diagnostic specification for UNDETERMINED cases

The earlier CSV uses generic missing-field names. The checklist below is authoritative about which stages apply: L1 has no sparse, fusion, reranking or parent-selection stage; L2 has no reranking or parent-selection stage. Missing diagnostics do not establish a failure at a stage that does not exist. No causes or failure counts are changed by this addendum. Field names proposed below are absent as dedicated fields in the selected final-run rows; final returned IDs and selected scores already exist.

| Level | What the selected saved run retains | Missing diagnostic fields / not-applicable stages | What an authorized diagnostic pass would record |
| --- | --- | --- | --- |
| L1 | retrieved[*].rank, chunk_id, child_id and scores.dense_score; metrics[1/3/5/10].entry_hits; failure_at_5. The saved ten returned dense results already retain IDs. | dense_candidate_ids with requested/actual limit and ordering as explicit stage provenance; candidate_union_entry_hits and per-candidate entry hits/ranks. No sparse/fusion/rerank/parent fields apply. | Reuse saved dense IDs where complete; record whether each required entry is in that exact list and its dense position, distinguish rank 6–10 from absent-at-limit, and record the answering top-five cutoff. No extra duplicate ID list is needed if the existing returned list is explicitly proven complete. |
| L2 | retrieved[*].rank, chunk_id, child_id, scores.dense_rank and scores.bm25_rank are retained for returned contexts only. | dense_candidate_ids, bm25_candidate_ids (sparse channel), fused_candidate_ids, candidate_union_entry_hits, post_fusion_entry_hits, per-candidate per-entry membership/ranks. No rerank/parent fields apply. | Record the complete ordered dense-20 and BM25-20 IDs, scores and limits; full union and fusion order before the final cutoff; per-entry evidence membership at each stage. Returned-context score ranks alone do not identify dropped candidates. |
| L3 | retrieved[*].rank, chunk_id (returned parent), child_id (selected child), scores.dense_rank, scores.sparse_rank and scores.rerank_score; parent_token_sizes, unique_parents_returned and best_rerank_score. These describe selected outputs, not every child. | dense_candidate_ids, sparse_candidate_ids, fused_candidate_ids, candidate_union_entry_hits, post_fusion_entry_hits, reranked_child_entry_ranks/rerank_position, selected_child_to_parent_entry_hits and parent_selection_decisions for every considered child. | Record full ordered dense-20/sparse-20 lists and fusion shortlist; each child’s rerank score and final child position before deduplication; child-to-parent mappings, parent evidence membership, kept/dropped reasons, deduplication and output/token limits. Include rejected children and parents, not only selected outputs. |

L1/L2 are not rerank failures by construction; a diagnostic trace must also distinguish dense/fusion cutoff losses. L3 must compare gold-entry presence in candidates, reranked children and selected parent text to separate candidate, rerank and parent losses. Keep proposed diagnostic IDs/text in the private archive and publish neutral aggregate counts only.

Such a pass needs zero provider calls in the selected frozen processing-off mode: reuse cached snapshots, raw saved questions, existing candidate IDs where complete and local encoders/reranker where unrecorded candidate stages must be recovered. Disable query rewriting, retries, answer generation and ingestion/caption generation; no source rebuild or remote model download is needed if the necessary local assets are available. Recovering unsaved L2/L3 stages may require local model loads and store access, which remain prohibited in this task. Missing local assets would block that future pass rather than authorize a download or provider request. No diagnostic pass was run.
