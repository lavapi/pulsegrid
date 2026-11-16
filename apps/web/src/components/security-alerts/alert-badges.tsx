import { ALERT_STATUS_LABELS, type AlertSeverity, type AlertStatus } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { SEVERITY_TONES, severityLabel, STATUS_TONES } from '@/lib/security-alerts';

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <Badge tone={SEVERITY_TONES[severity]} dot>
      {severityLabel(severity)}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: AlertStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{ALERT_STATUS_LABELS[status]}</Badge>;
}
