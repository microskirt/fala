import { useEffect, useState } from 'react';

/*
 * Install to the home screen, as a hook.
 *
 * Chrome only offers its own install entry once the app is installable, and it
 * hides it in the address bar where most people never look. `main.jsx` already
 * stashes the one-shot `beforeinstallprompt` event and announces it, so the UI
 * can offer a plain button instead of hoping the listener finds the browser's.
 *
 * The button has to be honest about the cases where no prompt exists at all:
 * iOS never fires `beforeinstallprompt` and installs through the Share sheet,
 * and every browser refuses the whole flow outside a secure context (HTTPS or
 * localhost). Those cases get instructions rather than a dead button.
 */

function initialPrompt() {
  if (typeof window === 'undefined') return null;
  return window.__falaInstallPrompt || null;
}

function initialInstalled() {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [installed, setInstalled] = useState(initialInstalled);

  useEffect(() => {
    const onPrompt = () => setPrompt(initialPrompt());
    const onInstalled = () => {
      setPrompt(null);
      setInstalled(true);
    };
    window.addEventListener('fala:installprompt', onPrompt);
    window.addEventListener('fala:appinstalled', onInstalled);
    return () => {
      window.removeEventListener('fala:installprompt', onPrompt);
      window.removeEventListener('fala:appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    const event = window.__falaInstallPrompt;
    if (!event) return false;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      const accepted = choice?.outcome === 'accepted';
      if (accepted) {
        window.__falaInstallPrompt = null;
        setPrompt(null);
      }
      return accepted;
    } catch {
      return false;
    }
  };

  return { canInstall: !!prompt, installed, install };
}

/*
 * Why no prompt is available, in the order that matters to the person reading
 * it: already installed, then iOS, then the insecure origin that blocks every
 * browser, then the plain unsupported case.
 */
export function installBlockedReason() {
  if (typeof window === 'undefined') return 'unsupported';
  if (initialInstalled()) return 'installed';
  const ua = window.navigator.userAgent || '';
  const ios = /iphone|ipad|ipod/i.test(ua);
  if (ios) return 'ios';
  const secure =
    window.isSecureContext ||
    location.protocol === 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!secure) return 'insecure';
  return 'unsupported';
}
