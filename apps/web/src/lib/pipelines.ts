export const appPath = (id: string): string => `/pipelines/apps/${id}`;

export const pipelinePath = (appId: string, workflowId: string): string =>
  `${appPath(appId)}/workflows/${workflowId}`;

export const runPath = (appId: string, runId: string): string =>
  `${appPath(appId)}/runs/${runId}`;
