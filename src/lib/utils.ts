import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function truncate(s: string, n = 500): string {
  if (s.length <= n) return s;
  const h = Math.floor(n / 2);
  return s.slice(0, h) + '\n…[truncated]…\n' + s.slice(-h);
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function xsrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)_xsrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}
