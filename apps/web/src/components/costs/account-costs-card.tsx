import { type AccountCosts, isServiceCategory, type ServiceCost } from '@pulsegrid/shared';
import { RelativeTime } from '@/components/pipelines/relative-time';
import { ServiceIcon } from '@/components/service-icon';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { environmentLabel, environmentTone } from '@/lib/account-environment';
import { formatMoney, monthName, shownServices } from '@/lib/costs';

const ICON_SIZE = 20;
const NO_FIGURES_YET = 'Costs appear within an hour of connecting an account.';

function ServiceRows({
  title,
  services,
  currency,
}: {
  title: string;
  services: ServiceCost[];
  currency: string;
}) {
  return (
    <tbody>
      <tr className="border-b bg-muted/50">
        <th colSpan={3} scope="colgroup" className="px-5 py-2 text-left text-xs font-medium text-muted-foreground">
          {title}
        </th>
      </tr>
      {services.map(({ service, category, thisMonth, lastMonth }) => (
        <tr className="border-b last:border-0" key={service}>
          <td className="px-3 py-2.5 font-medium sm:px-5">
            <span className="flex items-center gap-2.5">
              {category && isServiceCategory(category) && <ServiceIcon category={category} size={ICON_SIZE} />}
              {service}
            </span>
          </td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right sm:px-5 tabular-nums">
            {formatMoney(thisMonth, currency)}
          </td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right sm:px-5 tabular-nums text-muted-foreground">
            {formatMoney(lastMonth, currency)}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export function AccountCostsCard({
  account,
  month,
  lastMonth,
}: {
  account: AccountCosts;
  month: string;
  lastMonth: string;
}) {
  const { accountName, currency, services, updatedAt, error } = account;
  const { connected, other } = shownServices(services);
  const hasFigures = currency !== null && connected.length + other.length > 0;

  return (
    <Card>
      <CardHeader
        title={accountName}
        action={<Badge tone={environmentTone(account)}>{environmentLabel(account)}</Badge>}
      />
      {error && <p className="border-b px-5 py-3 text-[13px] text-danger">{error}</p>}
      {hasFigures ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2.5 font-medium sm:px-5">Service</th>
                <th className="px-3 py-2.5 text-right sm:px-5 font-medium">{monthName(month)} so far</th>
                <th className="px-3 py-2.5 text-right sm:px-5 font-medium">{monthName(lastMonth)}</th>
              </tr>
            </thead>
            {connected.length > 0 && (
              <ServiceRows title="Connected services" services={connected} currency={currency} />
            )}
            {other.length > 0 && <ServiceRows title="Other services" services={other} currency={currency} />}
          </table>
        </div>
      ) : (
        !error && <p className="px-5 py-6 text-[13px] text-muted-foreground">{NO_FIGURES_YET}</p>
      )}
      {updatedAt && (
        <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">
          Updated <RelativeTime value={updatedAt} />
        </p>
      )}
    </Card>
  );
}
