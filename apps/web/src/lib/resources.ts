import 'server-only';
import type { Resource, ResourcePage } from '@pulsegrid/shared';
import { apiGet } from './server-api';

const PAGE_SIZE = '100';
const MAX_PAGES = 10;

export const loadResources = async (filters: URLSearchParams): Promise<Resource[]> => {
  const resources: Resource[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams(filters);
    params.set('limit', PAGE_SIZE);
    if (cursor) {
      params.set('cursor', cursor);
    }
    const result: ResourcePage = await apiGet<ResourcePage>(`/resources?${params}`);
    resources.push(...result.resources);
    cursor = result.nextCursor;
    if (!cursor) {
      break;
    }
  }
  return resources;
};
