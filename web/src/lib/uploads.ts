export type UploadLevel = 1 | 2;
type UploadFile = Pick<File, 'name' | 'size' | 'type'>;
export const uploadConfig = {
  maxFiles: 2,
  maxBytes: 5 * 1024 * 1024,
  accept: '.pdf,application/pdf',
  extension: 'pdf',
  mime: 'application/pdf',
} as const;
const megabytes = (bytes: number) =>
  (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '');
export function validateFiles(
  files: UploadFile[],
  _level: UploadLevel,
  remaining = uploadConfig.maxFiles as number,
  maxBytes = uploadConfig.maxBytes as number,
  existing: UploadFile[] = [],
): string | null {
  if (!files.length) return 'Choose at least one document.';
  if (files.length > remaining)
    return `Up to ${uploadConfig.maxFiles} documents per session. Remove one to add another.`;
  const seen = new Set(
    existing.map((file) => `${file.name}\0${file.size}\0${file.type}`),
  );
  for (const file of files) {
    const extension = file.name.includes('.')
      ? file.name.split('.').pop()!.toLowerCase()
      : '';
    if (extension !== uploadConfig.extension)
      return extension
        ? `That’s a .${extension} file. Only text PDFs work here.`
        : 'This file has no .pdf extension. Only text PDFs work here.';
    if (file.type && file.type !== uploadConfig.mime)
      return 'This file is labeled as a different file type. Only text PDFs work here.';
    if (!file.size)
      return 'This PDF is empty. Choose a PDF that contains text.';
    if (file.size > maxBytes)
      return `This PDF is ${megabytes(file.size)} MB. The limit is ${megabytes(maxBytes)} MB.`;
    const key = `${file.name}\0${file.size}\0${file.type}`;
    if (seen.has(key))
      return 'This PDF has already been added. Choose a different document.';
    seen.add(key);
  }
  return null;
}
