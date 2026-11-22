import { toast as sonner } from 'sonner';

/*
 * One toast API for the whole app, backed by sonner.
 * Call sites use toast.success / toast.error / toast.info.
 */

export const toast = {
  success: (message) => sonner.success(message),
  error: (message) => sonner.error(message),
  info: (message) => sonner.info(message),
  message: (message) => sonner(message),
  dismiss: (id) => sonner.dismiss(id),
};

export function useToast() {
  return toast;
}
