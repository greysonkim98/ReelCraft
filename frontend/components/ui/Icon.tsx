import type { CSSProperties } from 'react';
export type IconName =
  | 'grid'
  | 'film'
  | 'plus'
  | 'arrow'
  | 'chevron'
  | 'search'
  | 'clock'
  | 'sparkles'
  | 'shield'
  | 'settings'
  | 'user'
  | 'users'
  | 'globe'
  | 'activity'
  | 'logout'
  | 'upload'
  | 'check'
  | 'close'
  | 'menu'
  | 'play'
  | 'download'
  | 'edit'
  | 'trash'
  | 'copy'
  | 'help'
  | 'sliders'
  | 'list'
  | 'volume';
const paths: Record<IconName, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  film: 'M4 3h16v18H4z M4 7h16 M4 17h16 M8 3v4 M16 3v4 M8 17v4 M16 17v4',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  sparkles: 'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3 M20 2v4 M18 4h4',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3 M8 12l3 3 5-6',
  settings:
    'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  users:
    'M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M3 21v-2a8 8 0 0 1 16 0v2 M18 3a4 4 0 0 1 0 8 M21 15l1 6',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c6 5 6 15 0 20-6-5-6-15 0-20',
  activity: 'M2 12h4l3-8 6 16 3-8h4',
  logout: 'M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5',
  upload: 'M12 16V3 M7 8l5-5 5 5 M3 15v6h18v-6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12 M6 18 18 6',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  play: 'm8 4 12 8-12 8V4',
  download: 'M12 3v13 M7 11l5 5 5-5 M3 16v5h18v-5',
  edit: 'm15 4 5 5 M4 15 16 3l5 5L9 20H4v-5',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  copy: 'M9 9h12v12H9z M15 6V3H3v12h3',
  help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  sliders:
    'M4 3v8 M4 15v6 M2 11h4v4H2z M12 3v3 M12 10v11 M10 6h4v4h-4z M20 3v12 M20 19v2 M18 15h4v4h-4z',
  list: 'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',
  volume: 'm3 9 5 0 5-5v16l-5-5H3V9 M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14',
};
export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
