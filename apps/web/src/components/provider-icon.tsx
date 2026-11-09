import { cloudProvider, gitProvider } from '@pulsegrid/shared';

export function ProviderIcon({ provider, size = 20 }: { provider: string; size?: number }) {
  const definition = cloudProvider(provider) ?? gitProvider(provider);
  if (!definition) {
    return null;
  }
  const { icon, darkIcon, label } = definition;
  const image = (src: string, className: string) => (
    <img className={className} src={src} alt={label} width={size} height={size} />
  );
  return darkIcon ? (
    <>
      {image(icon, 'shrink-0 rounded dark:hidden')}
      {image(darkIcon, 'hidden shrink-0 rounded dark:block')}
    </>
  ) : (
    image(icon, 'shrink-0 rounded')
  );
}
