import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type DragEvent,
} from 'react';
import {
  CloudUpload,
  FileText,
  FileImage,
  Trash2,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ErrorNotice from '../ErrorNotice';
import { cn } from '@/lib/utils';
import { uploadConfig, validateFiles, type UploadLevel } from '@/lib/uploads';

export type FileStatus = 'idle' | 'uploading' | 'success' | 'error';
export interface FileItem {
  id: string;
  file: File;
  progress: number;
  status: FileStatus;
  errorMessage?: string;
}
export interface FileUploadProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'onDrop'
> {
  onFilesAdded?: (files: File[]) => void;
  onFileRemove?: (id: string) => void;
  maxFiles?: number;
  remainingFiles?: number;
  maxSizeMB?: number;
  level?: UploadLevel;
  files?: FileItem[];
  disabled?: boolean;
  preview?: boolean;
}

// Watermelon file-upload-2; the caller owns upload state and the session quota.
export function FileUpload({
  onFilesAdded,
  onFileRemove,
  maxFiles = uploadConfig.maxFiles,
  remainingFiles,
  maxSizeMB = uploadConfig.maxBytes / 1024 / 1024,
  level = 1,
  files = [],
  disabled = false,
  preview = false,
  className,
  ...props
}: FileUploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<
    'idle' | 'validating' | 'valid' | 'invalid'
  >('idle');
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );
  const accept = uploadConfig.accept;
  function add(selected: File[]) {
    if (disabled || preview || pending.current) return;
    setValidation('validating');
    const message = validateFiles(
      selected,
      level,
      remainingFiles ?? maxFiles - files.length,
      maxSizeMB * 1024 * 1024,
      files.map((item) => item.file),
    );
    setError(message);
    if (message) {
      setValidation('invalid');
      return;
    }
    pending.current = setTimeout(() => {
      pending.current = null;
      setValidation('valid');
      onFilesAdded?.(selected);
    }, 150);
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    add(Array.from(event.dataTransfer.files));
  }
  return (
    <div
      className={cn('w-full upload-shell', className)}
      {...props}
      data-upload-state={validation}
    >
      <Card className="gap-0 rounded-card border-border bg-card py-0 text-inherit shadow-none">
        <CardHeader className="px-6 pb-5 pt-6">
          <h3 className="text-product-label text-primary">
            Bring your own notes.
          </h3>
          <p className="text-body text-muted-foreground">
            Text PDFs. Up to {maxFiles} documents per session.
          </p>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div
            data-dropzone
            data-dragging={dragging && !disabled}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            className={cn(
              'flex min-h-60 flex-col items-center justify-center gap-4 rounded-card border border-dashed border-primary/50 bg-panel px-5 py-7 text-center',
              dragging && !disabled && 'border-primary bg-accent',
            )}
          >
            {validation === 'validating' ? (
              <LoaderCircle
                className="size-8 validation-spinner"
                aria-hidden="true"
              />
            ) : validation === 'valid' ? (
              <CircleCheck
                className="size-8 validation-check"
                aria-hidden="true"
              />
            ) : (
              <CloudUpload className="size-8" aria-hidden="true" />
            )}
            <p className="text-body">Drop your notes here</p>
            <p className="text-utility-nav text-muted-foreground">
              PDF only · {maxSizeMB} MiB per file
            </p>
            <input
              ref={input}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose notes to upload"
              disabled={disabled || preview || validation === 'validating'}
              multiple={maxFiles > 1}
              accept={accept}
              onChange={(event) => {
                add(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={disabled || preview || validation === 'validating'}
              onClick={() => input.current?.click()}
            >
              Browse files
            </Button>
            {preview && (
              <p className="text-utility-nav text-muted-foreground">
                Component preview · uploads are disabled
              </p>
            )}
          </div>
          <div className="mt-4" aria-live="polite" aria-atomic="true">
            {error ? (
              <ErrorNotice message={error} />
            ) : (
              <p className="text-body">
                {validation === 'validating'
                  ? 'Checking file name, type and size…'
                  : validation === 'valid'
                    ? 'PDF accepted. Ready to upload.'
                    : ''}
              </p>
            )}
          </div>
          {files.length > 0 && (
            <ul className="mt-5 space-y-3" aria-label="Selected documents">
              {files.map((item) => (
                <li
                  key={item.id}
                  className="file-row flex items-center gap-3 border-t border-border pt-3"
                >
                  {item.file.type.startsWith('image/') ? (
                    <FileImage size={20} aria-hidden="true" />
                  ) : (
                    <FileText size={20} aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body">{item.file.name}</p>
                    <p className="text-utility-nav text-muted-foreground">
                      {(item.file.size / 1024).toFixed(0)} KiB ·{' '}
                      {item.status === 'uploading'
                        ? 'Processing'
                        : item.status === 'success'
                          ? 'Ready'
                          : item.status === 'error'
                            ? (item.errorMessage ?? 'Upload failed')
                            : 'Queued'}
                    </p>
                  </div>
                  {item.status === 'success' && (
                    <CircleCheck size={18} aria-label="Ready" />
                  )}
                  {item.status === 'error' && (
                    <CircleAlert size={18} aria-label="Upload failed" />
                  )}
                  {onFileRemove &&
                    (item.status === 'idle' || item.status === 'error') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        onClick={() => onFileRemove(item.id)}
                        aria-label={`Remove ${item.file.name}`}
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
