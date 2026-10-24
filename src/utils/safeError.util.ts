export interface SafeErrorDetails {
  name?: string;
  code?: string | number;
  status?: number;
}

export const getSafeErrorDetails = (error: unknown): SafeErrorDetails => {
  if (!error || typeof error !== 'object') return {};

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const details: SafeErrorDetails = {};

  if (typeof candidate.name === 'string') details.name = candidate.name;
  if (typeof candidate.code === 'string' || typeof candidate.code === 'number') {
    details.code = candidate.code;
  }

  const status = candidate.status ?? candidate.statusCode;
  if (typeof status === 'number') details.status = status;

  return details;
};
