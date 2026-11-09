const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+$/;

export const isAwsRegion = (region: string): boolean => REGION_PATTERN.test(region);
