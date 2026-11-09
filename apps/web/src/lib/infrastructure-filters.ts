export interface InfrastructureFilters {
  region?: string;
  q?: string;
}

const FILTER_KEYS = ['region', 'q'] as const;

export const filterParams = (filters: InfrastructureFilters): URLSearchParams => {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) {
      params.set(key, value);
    }
  }
  return params;
};

export const accountParams = (accountId: string, filters: URLSearchParams): URLSearchParams => {
  const params = new URLSearchParams(filters);
  params.set('account', accountId);
  return params;
};

export const withQuery = (path: string, params: URLSearchParams): string => {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};
