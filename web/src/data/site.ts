export const site = {
  name: 'RAG-Ladder',
  repositoryPrivate: false,
  repository: 'https://github.com/Shahid-Malek/rag-ladder',
  repositoryApi: 'https://api.github.com/repos/Shahid-Malek/rag-ladder',
  contact: null,
  starCountFallback: null,
  localSetup:
    'https://github.com/Shahid-Malek/rag-ladder#private-local-workflows-and-publication',
  download: null,
} as const;

export const missingData = {
  goldExcerpts: {
    value: null,
    label: 'Gold evidence excerpts are not included in the public export',
  },
  contact: { value: null, label: 'Owner contact pending' },
} as const;
