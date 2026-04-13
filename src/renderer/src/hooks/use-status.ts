import { useState, useEffect } from 'react';
import { ipc } from '@/lib/ipc';

export function useStatus() {
  const [status, setStatus] = useState('Ready');

  useEffect(() => {
    if (!ipc) return;
    return ipc.onStatusChange(setStatus);
  }, []);

  const isError = status.includes('failed') || status.includes('required') || status.includes('not found');
  const isLoading = !isError && status !== 'Ready';

  return { status, isError, isLoading };
}
