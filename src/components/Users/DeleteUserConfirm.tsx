import React from 'react';

import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { PublicUser } from '../../types/api';

export interface DeleteUserConfirmProps {
  open: boolean;
  user: PublicUser | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteUserConfirm: React.FC<DeleteUserConfirmProps> = ({
  open,
  user,
  busy = false,
  onCancel,
  onConfirm,
}) => (
  <Modal
    open={open && Boolean(user)}
    onClose={() => {
      if (!busy) onCancel();
    }}
    title="Delete user?"
    description={
      user
        ? `Permanently delete "${user.username}"? Their request history will be removed.`
        : ''
    }
    actions={
      <>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={busy} disabled={busy}>
          Delete user
        </Button>
      </>
    }
  />
);

export default DeleteUserConfirm;
