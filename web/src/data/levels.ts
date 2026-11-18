export interface StageTech {
  name: string;
  role: string;
  kind: 'library' | 'service' | 'custom code';
  logo?:
    | 'llamaindex'
    | 'python'
    | 'postgresql'
    | 'langgraph'
    | 'groq'
    | 'openrouter'
    | 'qdrant'
    | 'numpy';
}
export interface Stage {
  id: string;
  name: string;
  detail: string;
  why: string;
  how: string;
  tech: StageTech[];
}
export interface LevelInfo {
  id: 'l1' | 'l2' | 'l3';
  slug: string;
  name: string;
  summary: string;
  conversation: string;
  stages: Stage[];
  limits: string[];
}
const answer: Stage = {
  id: 'answer',
  name: 'Generate and cite',
  detail:
    'An answer uses the selected notes and includes references to the supplied evidence.',
  why: 'Makes the supplied evidence inspectable. Citation membership does not prove factual support.',
  how: 'Selected passages are supplied as evidence, and the response includes source references.',
  tech: [
    {
      name: 'Groq',
      logo: 'groq',
      role: 'Generates an answer from the selected note passages.',
      kind: 'service',
    },
    {
      name: 'OpenRouter',
      logo: 'openrouter',
      role: 'Provides an alternative configured answer service.',
      kind: 'service',
    },
    {
      name: 'Custom code',
      role: 'Connects displayed references to the retrieved passages.',
      kind: 'custom code',
    },
  ],
};
export const levels: LevelInfo[] = [
  {
    id: 'l1',
    slug: 'naive',
    name: 'Naive',
    summary:
      'Page text, overlapping chunks and dense retrieval. A baseline you can follow.',
    conversation:
      'Single-turn; previous questions are not passed to the model.',
    stages: [
      {
        id: 'parse',
        name: 'Read page text',
        detail:
          'Extract readable text from your PDF while retaining page references.',
        why: 'Provides a readable baseline with page provenance.',
        how: 'Each page’s extracted text stays linked to its page reference.',
        tech: [
          {
            name: 'LlamaIndex PDFReader',
            role: 'Extracts page text while retaining page references.',
            kind: 'library',
            logo: 'llamaindex',
          },
        ],
      },
      {
        id: 'chunk',
        name: 'Split into windows',
        detail: 'Split the text into smaller, overlapping passages.',
        why: 'Keeps each passage bounded while retaining a small shared boundary.',
        how: 'The tokenizer marks text boundaries before overlapping windows are assembled.',
        tech: [
          {
            name: 'Custom code',
            role: 'Builds overlapping windows from the extracted text.',
            kind: 'custom code',
          },
          {
            name: 'Transformers',
            role: 'Provides the tokenizer used to measure text windows.',
            kind: 'library',
          },
        ],
      },
      {
        id: 'embed',
        name: 'Embed the notes',
        detail:
          'Prepare the passages so they can be compared with your question.',
        why: 'Places notes and questions in the same search space.',
        how: 'Each passage becomes a numerical vector in the same search space as a question.',
        tech: [
          {
            name: 'SentenceTransformers',
            role: 'Encodes note passages into vectors for meaning-based search.',
            kind: 'library',
          },
          {
            name: 'NumPy',
            logo: 'numpy',
            role: 'Prepares the passage vectors as numerical arrays.',
            kind: 'library',
          },
        ],
      },
      {
        id: 'retrieve',
        name: 'Search the original question',
        detail: 'Find passages related to the question as you wrote it.',
        why: 'Keeps the baseline’s retrieval path direct and inspectable.',
        how: 'The question is encoded and compared with stored passage vectors.',
        tech: [
          {
            name: 'FAISS',
            role: 'Finds passage vectors closest to the question vector.',
            kind: 'library',
          },
          {
            name: 'SentenceTransformers',
            role: 'Encodes the original question for the same search space.',
            kind: 'library',
          },
        ],
      },
      answer,
    ],
    limits: [
      'Image-only notes may contain no extractable text.',
      'Fixed windows and page boundaries can split evidence.',
      'Naive answers each question independently.',
    ],
  },
  {
    id: 'l2',
    slug: 'intermediate',
    name: 'Intermediate',
    summary:
      'Markdown, OCR and hybrid retrieval. Adds conversation history in the hosted demo.',
    conversation:
      'Multi-turn; eligible recent conversation can help resolve references.',
    stages: [
      {
        id: 'parse',
        name: 'Extract layout and OCR',
        detail: 'Read document text and use text recognition where needed.',
        why: 'Makes scanned text and document structure available to retrieval.',
        how: 'Pages are converted to Markdown before passages are prepared.',
        tech: [
          {
            name: 'PyMuPDF4LLM',
            role: 'Extracts page Markdown and enables text recognition where needed.',
            kind: 'library',
          },
        ],
      },
      {
        id: 'chunk',
        name: 'Keep heading ownership',
        detail:
          'Keep passages connected to their headings as the notes are divided.',
        why: 'Preserves headings while bounding the amount of text in a passage.',
        how: 'Headings accompany the smaller passages used for retrieval.',
        tech: [
          {
            name: 'Custom code',
            role: 'Keeps heading ownership while recursively dividing passages.',
            kind: 'custom code',
          },
          {
            name: 'Transformers',
            role: 'Measures passages with the embedding tokenizer.',
            kind: 'library',
          },
        ],
      },
      {
        id: 'embed',
        name: 'Build two search views',
        detail:
          'Prepare the same note text for meaning-based and keyword search.',
        why: 'Supports semantic similarity and exact vocabulary.',
        how: 'The same passage text feeds vector similarity and vocabulary matching.',
        tech: [
          {
            name: 'SentenceTransformers',
            role: 'Encodes note passages for meaning-based search.',
            kind: 'library',
          },
          {
            name: 'PostgreSQL / pgvector',
            role: 'Stores and searches passage vectors.',
            kind: 'library',
            logo: 'postgresql',
          },
          {
            name: 'rank-bm25',
            role: 'Builds the keyword-search view of the passages.',
            kind: 'library',
          },
        ],
      },
      {
        id: 'rewrite',
        name: 'Resolve references when needed',
        detail:
          'With processing enabled, recent conversation can help clarify a follow-up question.',
        why: 'Can turn a follow-up into a search query while keeping history separate from evidence.',
        how: 'Recent conversation can be used to turn a follow-up into a standalone search query.',
        tech: [
          {
            name: 'Custom code',
            role: 'Determines whether a follow-up needs a standalone search query.',
            kind: 'custom code',
          },
          {
            name: 'Groq',
            logo: 'groq',
            role: 'Can rewrite a follow-up using recent conversation.',
            kind: 'service',
          },
          {
            name: 'OpenRouter',
            logo: 'openrouter',
            role: 'Provides an alternative configured rewrite service.',
            kind: 'service',
          },
        ],
      },
      {
        id: 'retrieve',
        name: 'Fuse dense and keyword ranks',
        detail: 'Combine the passages found by the two search views.',
        why: 'Combines the two candidate sets with a shared rank rule.',
        how: 'Semantic and keyword lists are merged by rank before passages are selected.',
        tech: [
          {
            name: 'pgvector',
            role: 'Finds passages by vector similarity.',
            kind: 'library',
            logo: 'postgresql',
          },
          {
            name: 'rank-bm25',
            role: 'Ranks passages by the question’s vocabulary.',
            kind: 'library',
          },
          {
            name: 'Custom code',
            role: 'Combines semantic and keyword result ranks.',
            kind: 'custom code',
          },
        ],
      },
      answer,
    ],
    limits: [
      'OCR and extracted headings can be incomplete.',
      'A rewrite can change meaning; semantic equivalence is not checked.',
      'Conversation history is not evidence.',
    ],
  },
  {
    id: 'l3',
    slug: 'advanced',
    name: 'Advanced',
    summary:
      'Structured parsing, dense/sparse retrieval, reranking and parent context. Run this level locally.',
    conversation:
      'Advanced uses the private local path. No hosted session or conversation history.',
    stages: [
      {
        id: 'parse',
        name: 'Parse structure and figures',
        detail:
          'Read structured text and tables, with selected visual descriptions.',
        why: 'Allows table structure and selected visual descriptions to enter the searchable text.',
        how: 'Structured document text is combined with available text recognition and figure descriptions.',
        tech: [
          {
            name: 'Docling',
            role: 'Parses structured text and tables from the local PDF.',
            kind: 'library',
          },
          {
            name: 'RapidOCR',
            role: 'Runs local text recognition during structured parsing.',
            kind: 'library',
          },
          {
            name: 'PyMuPDF',
            role: 'Prepares selected figure images from PDF pages.',
            kind: 'library',
          },
          {
            name: 'OpenRouter',
            logo: 'openrouter',
            role: 'Can describe selected figures for searchable text.',
            kind: 'service',
          },
        ],
      },
      {
        id: 'chunk',
        name: 'Search children, retain parents',
        detail:
          'Keep smaller passages connected to their larger surrounding context.',
        why: 'Separates the unit used for search from the larger context used for an answer.',
        how: 'Smaller children are searched; associated parents supply surrounding context.',
        tech: [
          {
            name: 'Docling HybridChunker',
            role: 'Divides structured document content into passages.',
            kind: 'library',
          },
          {
            name: 'Custom code',
            role: 'Keeps smaller search passages connected to parent context.',
            kind: 'custom code',
          },
        ],
      },
      {
        id: 'embed',
        name: 'Encode dense and learned sparse',
        detail: 'Prepare complementary representations of the note passages.',
        why: 'Provides two search representations from the same notes.',
        how: 'Passages produce dense vectors and sparse term-weight representations.',
        tech: [
          {
            name: 'FlagEmbedding',
            role: 'Encodes dense and learned sparse passage representations.',
            kind: 'library',
          },
          {
            name: 'Qdrant',
            logo: 'qdrant',
            role: 'Stores the complementary vectors in the local search index.',
            kind: 'library',
          },
          {
            name: 'NumPy',
            logo: 'numpy',
            role: 'Prepares numerical vectors for the local index.',
            kind: 'library',
          },
        ],
      },
      {
        id: 'retrieve',
        name: 'Fuse and rerank children',
        detail:
          'Combine search results and reorder the shortlist against the question.',
        why: 'Reorders the shortlist before selecting surrounding context.',
        how: 'Dense and sparse candidates are combined before a cross-encoder orders the shortlist.',
        tech: [
          {
            name: 'Qdrant',
            logo: 'qdrant',
            role: 'Searches the local dense and sparse passage vectors.',
            kind: 'library',
          },
          {
            name: 'SentenceTransformers CrossEncoder',
            role: 'Reorders shortlisted passages against the question.',
            kind: 'library',
          },
          {
            name: 'Custom code',
            role: 'Fuses the two ranked search result lists.',
            kind: 'custom code',
          },
        ],
      },
      {
        id: 'expand',
        name: 'Expand and optionally retry',
        detail:
          'Include surrounding context and optionally try another search.',
        why: 'Supplies larger evidence spans. Weak results still reach generation.',
        how: 'Selected children lead to parent passages, while the workflow may run another search.',
        tech: [
          {
            name: 'LangGraph',
            role: 'Coordinates search, optional retry and answer steps.',
            kind: 'library',
            logo: 'langgraph',
          },
          {
            name: 'Custom code',
            role: 'Collects surrounding parent passages for selected results.',
            kind: 'custom code',
          },
        ],
      },
      answer,
    ],
    limits: [
      'No hosted Advanced session or conversation history.',
      'Caption facts and answer groundedness are not semantically verified.',
      'The shortlist can yield fewer distinct surrounding passages.',
    ],
  },
];
export const tradeoffs = [
  [
    'Input',
    'Text PDFs',
    'PDFs with text recognition',
    'PDFs with structured parsing',
  ],
  [
    'Passages',
    'Overlapping windows',
    'Heading-aware passages',
    'Smaller passages with surrounding context',
  ],
  [
    'Search',
    'Meaning-based search',
    'Meaning and keywords',
    'Complementary search and reranking',
  ],
  [
    'Conversation',
    'Independent questions',
    'Recent conversation',
    'No hosted conversation',
  ],
  ['Availability', 'Hosted session', 'Hosted session', 'Private local setup'],
];
export const levelName = (id: string) =>
  levels.find((level) => level.id.toUpperCase() === id.toUpperCase())?.name ??
  id;
