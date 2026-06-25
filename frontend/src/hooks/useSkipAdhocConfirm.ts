/**
 * When Application Settings → skip_adhoc_confirm_dialogs is Yes,
 * Bolt / r10k / Run OpenVox skip Mantine pre-flight confirms.
 * Destructive actions (purge, certs, ENC delete, users) are unaffected.
 */
import { useApi } from './useApi';
import { config } from '../services/api';

export function useSkipAdhocConfirm(): boolean {
  const { data } = useApi(config.getApp, []);
  return !!data?.skip_adhoc_confirm_dialogs;
}
