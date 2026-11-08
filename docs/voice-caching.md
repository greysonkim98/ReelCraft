# Voice caching

Voice generation stays on the device using the existing Kokoro model and voices. There are three reuse layers:

- The existing Transformers.js browser cache stores the model files after their first download. The model must still be initialized after a full page reload; preparation progress is not proof of a new network download.
- A shared in-session model promise avoids loading a model per line or sample. Failed loads can be retried.
- Generated narration and voice samples are cached in memory (up to 100 entries / 32 MiB) and in browser Cache Storage (up to 100 entries). Identical trimmed text, voice, speed, model, and audio format version reuse the saved WAV without loading Kokoro. Concurrent identical requests share one synthesis job. Callers receive independent byte buffers so FFmpeg transfers cannot destroy cached audio.

Persistent cache keys hash caption text and settings using SHA-256; keys do not expose caption text. Audio remains stored locally on the same browser origin. The cache does not upload text or audio. Clearing site data removes the cached audio and model. Private browsing, quota limits, storage eviction, and switching site origins can prevent persistent reuse. Cache errors never block synthesis.

The voice UI now says Preparing voice model because the library reports progress while reading both downloaded and cached files. The first use still requires the existing roughly 90 MB model. Avoiding a first-time model download completely requires a server-side TTS service; that is not enabled by this change.

Verification: frontend tests cover concurrent requests, different voices/speeds, model load retry, blocked storage, corrupted entries, transferred caller buffers, and a fresh module/session retrieving persisted audio without model initialization. For browser verification, generate narration once, then revisit with the same captions and settings and inspect the Network panel: audio-cache hits should not request the model. Use a new caption to confirm the cached model remains usable, and clear site data to exercise first-use behavior.
