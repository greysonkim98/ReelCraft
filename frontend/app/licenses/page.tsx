import { Contact, H2, LegalPage } from '@/components/LegalPage';

export const metadata = { title: 'Open-source licenses · ReelCraft' };

const ext = (href: string, label: string) => (
  <a className="underline" href={href} target="_blank" rel="noreferrer">
    {label}
  </a>
);

export default function Licenses() {
  return (
    <LegalPage title="Open-source licenses" updated="October 5, 2026">
      <p>ReelCraft is built with open-source software. The main components are listed here.</p>

      <H2>FFmpeg (ffmpeg.wasm), x264 and x265: GPL</H2>
      <p>
        Video analysis and encoding run in your browser using FFmpeg compiled to WebAssembly (the <code>@ffmpeg/core</code> package, version
        0.12.10, licensed GPL-2.0-or-later). This build includes the GPL-licensed encoders libx264 (H.264) and libx265 (HEVC). The
        FFmpeg wrapper <code>@ffmpeg/ffmpeg</code> is MIT licensed.
      </p>
      <p>The corresponding source code is available from:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>{ext('https://github.com/ffmpegwasm/ffmpeg.wasm', 'ffmpeg.wasm project (build scripts for the WebAssembly core)')}</li>
        <li>{ext('https://ffmpeg.org/download.html', 'FFmpeg source')}</li>
        <li>{ext('https://www.videolan.org/developers/x264.html', 'x264 source')}</li>
        <li>{ext('https://bitbucket.org/multicoreware/x265_git', 'x265 source')}</li>
      </ul>
      <p>
        You may receive the source on request at <Contact />. H.264 and HEVC are covered by patents held by third parties; this notice is not
        a patent license.
      </p>

      <H2>Other components</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Next.js, React: MIT</li>
        <li>Tailwind CSS: MIT</li>
        <li>Firebase JavaScript SDK: Apache-2.0</li>
        <li>Socket.IO client: MIT</li>
        <li>Noto Sans (caption font): SIL Open Font License 1.1</li>
      </ul>
    </LegalPage>
  );
}
