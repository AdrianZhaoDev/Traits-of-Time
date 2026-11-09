export type ContentIssueCode =
  | 'CONTENT_READ_FAILED'
  | 'JSON_PARSE'
  | 'SCHEMA_INVALID'
  | 'DUPLICATE_ID'
  | 'MISSING_REFERENCE'
  | 'INVALID_GRAPH'
  | 'INVALID_DISTRIBUTION'
  | 'INVALID_COMBINATION'
  | 'CONTENT_PATH_INVALID';

export interface ValidationIssue {
  file: string;
  path: string;
  code: ContentIssueCode;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export function pointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Convert the assembled bundle's pointer into a file-local JSON Pointer. */
export function bundleLocation(pointer: string): { file: string; path: string } {
  const separator = pointer.indexOf('/', 1);
  const key = pointer.slice(1, separator === -1 ? undefined : separator);
  return {
    file: key ? `${key}.json` : 'manifest.json',
    path: separator === -1 ? '' : pointer.slice(separator),
  };
}
