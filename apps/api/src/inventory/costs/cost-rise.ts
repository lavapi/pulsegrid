/** A month heading this much above last month is a sharp rise... */
const RISE_SHARE = 0.25;
/** ...when it's also at least this much more, so small accounts don't hear about cents. */
const RISE_AMOUNT = 50;
/** Charges billed on the first days, such as support plans, would look like a rise before this. */
const FIRST_DAY_CHECKED = 5;

export interface ServiceMonths {
  service: string;
  thisMonth: number;
  lastMonth: number;
}

export interface CostRise {
  projected: number;
  lastMonth: number;
  /** From 0, such as 0.38 for 38% more. */
  share: number;
  biggest: { service: string; amount: number } | null;
}

const daysIn = (now: Date): number => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

/** Where this month is heading from the days so far, and whether that's a sharp rise over last month. */
export const costRise = (services: readonly ServiceMonths[], now: Date): CostRise | null => {
  const day = now.getUTCDate();
  if (day < FIRST_DAY_CHECKED) return null;
  const scale = daysIn(now) / day;
  const lastMonth = services.reduce((sum, { lastMonth: amount }) => sum + amount, 0);
  const projected = services.reduce((sum, { thisMonth }) => sum + thisMonth, 0) * scale;
  if (lastMonth <= 0 || projected < lastMonth * (1 + RISE_SHARE) || projected - lastMonth < RISE_AMOUNT) return null;
  const rises = services
    .map(({ service, thisMonth, lastMonth: before }) => ({ service, amount: thisMonth * scale - before }))
    .sort((a, b) => b.amount - a.amount);
  const biggest = rises[0] && rises[0].amount > 0 ? rises[0] : null;
  return { projected, lastMonth, share: projected / lastMonth - 1, biggest };
};
