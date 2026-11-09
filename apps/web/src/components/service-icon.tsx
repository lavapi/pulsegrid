import { SERVICE_CATEGORIES, type ServiceCategory } from '@pulsegrid/shared';

export function ServiceIcon({ category, size = 44 }: { category: ServiceCategory; size?: number }) {
  return (
    <img
      className="shrink-0 rounded-lg"
      src={`/cloud-icons/${SERVICE_CATEGORIES[category].provider}/${category}.svg`}
      alt=""
      width={size}
      height={size}
    />
  );
}
