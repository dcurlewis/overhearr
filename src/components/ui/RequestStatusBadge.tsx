import React from 'react';
import { Badge, type BadgeVariant } from './Badge';
import type { RequestStatusInfo, RequestStatusValue } from '../../types/api';

export interface RequestStatusBadgeProps {
  status: RequestStatusInfo;
  errorMessage?: string | null;
}

const LABEL: Record<RequestStatusValue, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  AVAILABLE: 'Available',
  FAILED: 'Failed',
};

const VARIANT: Record<RequestStatusValue, BadgeVariant> = {
  PENDING: 'info',
  PROCESSING: 'warning',
  AVAILABLE: 'success',
  FAILED: 'danger',
};

export const RequestStatusBadge: React.FC<RequestStatusBadgeProps> = ({
  status,
  errorMessage,
}) => {
  if (!status.exists) {
    return <Badge variant="neutral">Not requested</Badge>;
  }
  return (
    <Badge variant={VARIANT[status.status]} title={errorMessage ?? undefined}>
      {LABEL[status.status]}
    </Badge>
  );
};

export default RequestStatusBadge;
