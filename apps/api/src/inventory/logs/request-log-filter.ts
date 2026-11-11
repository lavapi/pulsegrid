import { type RequestLogEntry, type RequestLogFilter, STATUS_CLASSES, type StatusClass } from '@pulsegrid/shared';

const contains = (value: string, wanted: string | undefined): boolean =>
  !wanted || value.toLowerCase().includes(wanted.toLowerCase());

/** The status a request ended with: the load balancer's, which is the target's when there was one. */
const statusOf = ({ elbStatus, targetStatus }: RequestLogEntry): number | null => elbStatus ?? targetStatus;

const statusMatches = (entry: RequestLogEntry, wanted: string | undefined): boolean => {
  if (!wanted) {
    return true;
  }
  const status = statusOf(entry);
  if (status === null) {
    return false;
  }
  if ((STATUS_CLASSES as readonly string[]).includes(wanted)) {
    return Math.floor(status / 100) === Number((wanted as StatusClass)[0]);
  }
  return status === Number(wanted);
};

const pathOf = (path: string, withQuery: boolean): string => {
  if (withQuery) {
    return path;
  }
  const index = path.indexOf('?');
  return index === -1 ? path : path.slice(0, index);
};

/** Keeps the requests a filter asks for. Paths are compared without their query string unless it's shown. */
export const requestMatcher =
  (filter: RequestLogFilter) =>
  (entry: RequestLogEntry): boolean =>
    contains(entry.host, filter.host) &&
    contains(pathOf(entry.path, Boolean(filter.showQuery)), filter.path) &&
    statusMatches(entry, filter.status) &&
    contains(entry.service ?? '', filter.service) &&
    contains(entry.userAgent, filter.userAgent) &&
    (filter.minResponseMs === undefined || (entry.responseMs ?? -1) >= filter.minResponseMs);

/** The entry as shown: without the query string unless the person may see it and asked to. */
export const shown = (entry: RequestLogEntry, showQuery: boolean): RequestLogEntry =>
  showQuery ? entry : { ...entry, path: pathOf(entry.path, false) };

export { statusOf };
