/** @type {import('next').NextConfig} */

// `npm run export` builds a fully static site (NEXT_EXPORT=1) for Firebase Hosting. Static hosting
// ignores headers() here, so the same headers live in /firebase.json. `next dev` and `next start`
// keep using headers() below.
const exporting = process.env.NEXT_EXPORT === '1';

// SharedArrayBuffer (multi-thread ffmpeg.wasm) needs cross-origin isolation. Apply it only to
// /editor (and the same-origin assets it loads). The landing page runs Google sign-in, whose
// redirect helper cannot load on an isolated page.
const isolation = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
];

const nextConfig = {
  transpilePackages: ['@reelcraft/shared'],
  ...(exporting
    ? { output: 'export', images: { unoptimized: true } }
    : {
        async headers() {
          return [
            { source: '/editor', headers: isolation },
            { source: '/editor/:path*', headers: isolation },
            {
              source: '/ffmpeg/:path*',
              headers: [
                { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
                { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
              ],
            },
            {
              source: '/fonts/:path*',
              headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }],
            },
          ];
        },
      }),
};

module.exports = nextConfig;
