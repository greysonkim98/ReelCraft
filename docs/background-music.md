# Optional background music

Set `EPIDEMIC_SOUND_API_KEY` in the repo-root `.env` or backend deployment environment. Never use a `NEXT_PUBLIC_` key. Restart the backend after changing configuration. hls.js is the only added dependency; it provides the official HLS preview format in browsers without native support.

Music controls appear in the existing Voice, Review, Render, and Share stages. Recommendations describe the existing captions, clip notes, topic, tempo, and color style; no additional AI request is made. Users can also search manually. Search and recommendations show only explicitly downloadable tracks (`isPreviewOnly: false`); preview-only or unknown-access tracks are hidden. Search scans up to three pages to find available matches. If none are found, the backend opens collection details and ranks explicitly available tracks using the video/search description against track titles, artists, collection names, moods, genres, and instrumental preference. Collection summaries can incorrectly label included tracks preview-only; collection details return the correct free-tier flags. The UI labels these results as included-collection suggestions. Successful collection lookups are cached per user for five minutes; empty results are not cached so newly enabled collections can be retried immediately. Availability does not imply an unrestricted or public-domain license. The backend rechecks download eligibility and honors upstream permission/rate-limit errors. License access comes from the Epidemic Sound agreement, not from possessing an API key alone.

Selections and volume remain in the mounted editor across stage navigation. After script generation they are also saved on the existing project record. Existing project restoration is a sample/placeholder feature; this change does not add restoration of footage or edit sessions after page reload.

FFmpeg renders from original clips each time, retaining the existing original-audio and voiceover mix. Music loops, trims to timeline length, fades out, and is reduced further when narration is enabled. Disabling/removing music omits its input and filters entirely. Any music change clears the previous output so an outdated soundtrack cannot be downloaded. At Share, choose Render updated preview after a change, then audition the resulting video before download.

Search, preview links, download links, metadata, and export reporting use authenticated backend endpoints. Only provider-issued media links reach the browser; CDN media requests do not receive the API key. Download links are cached per anonymous user/track only until expiry, with concurrent downloads deduplicated. The provider meters previews/downloads; final composition download/share reports `EXPORTED` with platform `LOCAL`. Failed reporting asks the user to retry or remove the music rather than silently exporting unreported licensed content.

## Manual verification

1. Start backend and frontend with the existing development commands, sign in, and create a reel with music unchecked. Render, preview, download, and revisit editing as before.
2. Enable music in Voice or Review. Inspect recommendations, search another mood, and preview a track. Verify preview-only tracks have Select disabled.
3. Select an available track, set volume, render, and listen for original clip audio and narration. Check that the video duration matches the timeline and short music loops.
4. At Share, change tracks or volume; the old download disappears. Render updated preview, audition, then download.
5. Remove music at Share, render again, and confirm only original audio/narration remain. Return to editing and add music again.
6. Simulate provider errors/disable the key: music controls show an error; turning music off allows normal rendering. Check browser network/build output for absence of the key.

## Automated verification

`npm test` covers provider authentication, search, preview, eligibility, download URL reuse, export reporting, failures, project ownership and preference persistence, and FFmpeg command composition including volume/change/removal. `npm run typecheck`, `npm run lint`, and `npm run build` validate the workspaces. `npm run verify:render` requires native ffmpeg/ffprobe on PATH; it cannot run on a machine without them. Browser playback and licensed composition download still require the manual checks above.

Official references:
- https://developers.epidemicsound.com/docs/auth/
- https://developers.epidemicsound.com/docs/api-reference/
- https://developers.epidemicsound.com/docs/report-usage/

The **Pick music for me** button searches using the existing video description (not the manual search box) and selects the highest-ranked available track. It makes no additional AI call and does not download or autoplay music. Users can preview, replace, adjust, or remove the selection as usual. An empty result or API failure leaves the current selection unchanged.

Verified live after the collection-details correction: a Fortnite-themed query returned 12 available tracks, and one selected track download and CDN audio fetch succeeded. This test consumed one music download and did not report an export.
