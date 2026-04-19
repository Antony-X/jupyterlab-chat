import { useCallback, useEffect, useState } from 'react';

const KEY = 'jc-theme';

export function useTheme(): { theme: 'light' | 'dark'; toggle: () => void } {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* quota / private mode — ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}
