import { useEffect } from 'react';

import type { ThemePreference } from '../shared/types';

/**
 * Stamps the resolved theme on <html> for Tailwind's selector-based dark mode.
 * 'auto' tracks the OS live, so the popup follows a system change while open.
 */
export function useTheme(preference: ThemePreference): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = (): void => {
      const resolved =
        preference === 'auto' ? (media.matches ? 'dark' : 'light') : preference;
      document.documentElement.setAttribute('data-theme', resolved);
    };

    apply();
    if (preference !== 'auto') return undefined;

    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);
}
