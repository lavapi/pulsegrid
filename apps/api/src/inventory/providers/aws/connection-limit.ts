import { type ParameterValue, parameterValue } from './parameter-formula';

/** RDS max_connections, from its parameter group value. */
export type ConnectionLimit = ParameterValue;

/** The connection limit, or null when the setting is missing or a formula this can't read. */
export const connectionLimit = (setting: string | null, memoryBytes: number | null): ConnectionLimit | null => {
  const read = parameterValue(setting, memoryBytes);
  const value = read ? Math.floor(read.value) : 0;
  return read && value > 0 ? { value, estimated: read.estimated } : null;
};
