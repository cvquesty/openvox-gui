/**
 * Route gate for viewer-hidden mutate pages.
 * Renders inside the app shell so the sidebar stays available.
 */
import { Button } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../hooks/AuthContext';
import { canAccessPath } from '../utils/canAccess';
import { EmptyState } from './StateComponents';

export function RequireAccess() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!canAccessPath(location.pathname, user?.role)) {
    return (
      <EmptyState
        icon={<IconLock size={40} stroke={1.25} />}
        title="Read-only access"
        description="Your viewer role can browse the fleet, reports, and insights. This page changes the estate, so it is not available."
        action={(
          <Button variant="light" onClick={() => navigate('/', { replace: true })}>
            Back to Dashboard
          </Button>
        )}
      />
    );
  }

  return <Outlet />;
}
