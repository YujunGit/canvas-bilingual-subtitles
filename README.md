# Canvas / Kaltura Bilingual Subtitles

**English** | [简体中文](README.zh-CN.md)

A Tampermonkey userscript that adds synchronized bilingual subtitles to Kaltura course videos in Canvas. Automatically import English SRT captions, translate them with Google Cloud Translation or Azure AI Translator, and cache the results.

> Automatic import targets the Kaltura PlayKit downloads panel. Player configurations vary between institutions; manual SRT import remains available when automatic retrieval fails.

## Features

- **Automatic subtitle import:** Find the single English SRT entry in the downloads panel and import it directly, without selecting a file from your Downloads folder.
- **Optional automatic translation:** Retrieve, translate, and display captions after a video loads, or run the workflow manually.
- **Two translation providers:** Google Cloud Translation Basic v2 and Azure AI Translator, with an extensible Provider Adapter interface.
- **Synchronized display:** Bilingual, original-only, and translation-only modes, plus a timing offset. Follows pauses, seeking, and playback speed changes.
- **Batching and caching:** Deduplicate text, batch requests, reuse completed batches after failures, cancel translation, and clear the cache.
- **Subtitle appearance:** Customize text and background colors and background transparency. Drag subtitles, remember their position, or restore the default position.
- **Compact settings panel:** A draggable button with a saved position and diagnostics collapsed by default.

## Roadmap

These items are planned and **not yet implemented**. Providers, compatibility, and release order will depend on feasibility testing and user feedback.

### More translation APIs

- [ ] Extend Provider Adapters and evaluate services such as DeepL, Baidu Translate, and Tencent Cloud Machine Translation.
- [ ] Explore APIs for translation with large language models, including configurable OpenAI-compatible endpoints.
- [ ] Add provider-specific credentials, language mappings, batch limits, and error messages while keeping translation caches isolated by provider.
- [ ] Add setup documentation and tests for subtitle order, response formats, cancellation, and failure recovery.

### More languages

- [ ] Expand source and target language selection to support subtitle input beyond English and more translation language pairs.
- [ ] Offer language options based on the selected provider's capabilities and explain unsupported combinations.
- [ ] Improve subtitle layout for different writing systems, including right-to-left languages, and verify parsing, line wrapping, and synchronization.

### macOS system translation

- [ ] Explore integration with Apple's Translation framework through a local Provider using macOS translation capabilities.
- [ ] Validate a local macOS companion app that calls the framework and communicates with the userscript, without assuming Tampermonkey can call native frameworks directly.
- [ ] Verify system requirements, supported languages, language resource downloads, and offline conditions, and design the initial authorization and preparation flow.
- [ ] Validate access controls for local communication, batch translation, cancellation, and error recovery. Prompt users to choose an existing online Provider when the local service is unavailable.

This integration is exploratory. The current version does not support Apple Translation, and support for every language or macOS version is not promised.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser and follow its prompts to enable userscripts and access to the target sites.
2. Open `dist/canvas-bilingual.user.js` in this repository and select **Raw**.
3. If Tampermonkey opens an installation page, confirm installation. Otherwise, create a new script, **replace the entire default template** with the file contents, and save.
4. Refresh your Canvas course page.

To update, replace the existing script's complete contents. Do not append new code to the old version. Keep the script name and namespace to avoid duplicate installations.

## Quick start

The current settings UI uses Chinese labels; the relevant labels are included below to help you locate each control.

### 1. Configure a translation provider

Open the **双语字幕** (Bilingual Subtitles) panel **inside the player**. Select a provider, enter your API key and target language, and click **保存设置** (Save settings). Google and Azure keys are stored separately.

| Provider | Required settings | Notes |
| --- | --- | --- |
| Google Cloud Translation Basic v2 | API key, target language | Use a key from a project with the corresponding API enabled |
| Azure AI Translator | API key, target language | Enter the region required by your resource; applicable global single-service resources may leave it empty |

Current target languages are Simplified Chinese, Traditional Chinese, Japanese, and Korean. The source language is English.

### 2. Import subtitles

Load the course video and start playback if necessary. **打开视频后自动获取英文字幕** (Automatically retrieve English subtitles after loading a video) is enabled by default. On success, the panel shows the filename and cue count.

If automatic retrieval fails, download the English `.srt` from the player's upper-right downloads panel and use **手动导入英文 SRT** (Manually import English SRT). Plain transcripts without timestamps cannot be synchronized.

### 3. Translate and display

- Click **自动获取并翻译** (Automatically retrieve and translate) to retrieve, import, and translate in one step.
- If captions are already imported, click **批量翻译** (Batch translate).
- Enable **获取后自动翻译** (Automatically translate after retrieval) to translate subsequent videos automatically. This setting saves immediately. **Automatic translation is off by default** and may incur API charges when enabled.

The initial display mode is bilingual. You can switch to original-only or translation-only; the choice saves automatically and is restored after refresh without clicking Save settings. Adjust the subtitle delay if needed: positive values make captions appear later. Disable the player's own captions manually if they overlap.

Use **字幕背景透明度** (Subtitle background transparency) for a live preview; releasing the slider saves the setting. At 0% the background is opaque, and at 100% it is fully transparent. Text remains opaque. The default transparency is 22%. Use **字幕文字颜色** (Subtitle text color) and **字幕背景颜色** (Subtitle background color) to preview colors and save them on confirmation. Defaults are white text on a black background; background color and transparency work together.

Drag the visible subtitle area to reposition it; releasing saves the position. The box stays inside the video and uses relative positioning when video dimensions change. Hover over the subtitle box to reveal handles on its left and right edges. Drag either edge to resize it while keeping the opposite edge fixed; text wraps to the new width. Width is saved as a proportion of the video (20–100%, default 88%). Use **恢复字幕默认宽度** (Restore default subtitle width) to reset it. Click **恢复字幕默认位置** (Restore default subtitle position) to return to the bottom. Appearance settings are saved separately by site and page/player-frame context.

## Compatibility and limitations

- The script runs independently in matching pages and iframes. A button may also appear on the outer Canvas page; use the panel inside the actual player.
- Default matches are `*.instructure.com`, `cdnapisec.kaltura.com`, and `*.mediaspace.kaltura.com`. Custom institutional domains require an appropriate `@match` entry.
- Only a single unambiguous loaded video is selected automatically. Multiple valid videos require manual selection.
- Automatic retrieval requires exactly one English SRT entry in the downloads panel. Ambiguous candidates, permission restrictions, or player changes may require manual import.
- SRT supports UTF-8, BOM, CRLF, and multiline text, with a 5 MB file limit.
- Subtitle overlays work on normal pages. Container fullscreen behavior depends on the player layout. Native video fullscreen and picture-in-picture do not display the DOM subtitle overlay.
- Replacing the video element or changing its source clears the current captions to prevent displaying captions from another video. Some quality changes may also trigger retrieval again.

## Storage and costs

API keys and settings are stored in Tampermonkey's script storage, not the webpage's localStorage or project files. This storage is not an encrypted keychain; extension backup and synchronization settings may affect where data goes.

Translation sends subtitle text to the selected Google or Azure service. Google v2 places the key in a request URL parameter; Azure places it in a request header. Redact credentials before sharing network logs.

Cache entries are separated by provider, version, source language, target language, and original text. They expire after 30 days and are trimmed to at most 5,000 entries at startup and after translation. Retrieving identical captions can reuse valid cached translations. Source subtitle files remain only in the current page's memory.

Each batch contains at most 50 texts and 4,500 UTF-16 characters. HTTP 429 responses are retried up to twice; other request failures require a manual retry. Cancellation cannot undo requests already sent or their charges. Multiple tabs translating the same captions may still send duplicate requests.

## Troubleshooting

**Translation finished, but no subtitles appear?**

Click **检测播放器** (Inspect player). Check that the selected course video has a real duration rather than a standby element showing “? 秒”. Also check the display mode and **显示字幕** (Show subtitles) toggle.

**The button does nothing, or a large block of code appears?**

Check for mixed versions or duplicate installations. Replace the entire userscript with the updated file and refresh the course page.

**Automatic retrieval does not work?**

Load the video, then click **自动获取并翻译**. Confirm that the downloads panel offers English SRT captions. If it still fails, import manually and expand **高级诊断** (Advanced diagnostics) to inspect the player state.

**Source edits do not appear in the browser?**

The browser runs the installed build. Rebuild and update the userscript after changing the source, then refresh the course page.

## Development and extension

The project uses JavaScript ES Modules with no third-party npm dependencies for building or testing. Use Node.js with its built-in test runner; the project has been run on Node.js 24.

```sh
npm run build
npm test
```

| File | Responsibility |
| --- | --- |
| `src/main.js` | Settings UI, storage, and workflow orchestration |
| `src/auto-subtitles.js` | English SRT discovery, download capture, and automatic import |
| `src/subtitles.js` | SRT parsing, active cue selection, and batching |
| `src/providers.js` | Translation adapters and network transport |
| `src/translation.js` | Deduplication, caching, retries, and cancellation |
| `src/player.js` | Video discovery, binding, and subtitle rendering |
| `src/floating-ui.js` | Draggable button and panel positioning |
| `build.mjs` | Standalone userscript generation |
| `test/` | Parsing, adapter, cache, and automatic import tests |

To add a service, implement this interface in the Provider registry, then add credential controls and precise `@connect` domains:

```js
{
  id,
  version,
  name,
  language(target),
  async translate(texts, config, post) { /* Return string[] */ }
}
```

Results must match the input length and order. Update the cache version or cache key when changing the translation model or settings that affect the output.

### Validation coverage

- Automatic English SRT import and Google translation have been validated with Edge, Tampermonkey, and one Canvas / Kaltura PlayKit course environment.
- Azure request formats have mock test coverage; end-to-end testing with a real key has not been completed.
- Automated tests cover SRT formats, timing boundaries, video selection, request formats, cache isolation, cancellation, failure recovery, and download capture.
- Tests use `test/fixtures/synthetic.srt`, an original synthetic fixture distributed under the project's MIT License. No course subtitles are required. SRT files are ignored by default; only this synthetic fixture is explicitly allowed.
- Compatibility with every institutional setup, browser, fullscreen mode, or future player version is not guaranteed.

## Changelog

Versions are listed newest first. Dates indicate implementation dates, not published GitHub Releases.

### v0.3.3 · 2026-11-12

- Resize the subtitle box by dragging its left or right edge, with automatic width saving and a reset control.
- Preserve dragging from the middle to reposition subtitles; keep resizing within video bounds.
- Save width relative to the video (20–100%, default 88%) and wrap text to fit.
- Add resize boundary tests; all 21 automated tests and build checks pass. Browser interaction has not been verified for this version.

### v0.3.2 · 2026-11-11

- Add subtitle text and background color settings with live preview and automatic saving.
- Combine background color with the existing transparency setting; retain white-on-black defaults.

### v0.3.1 · 2026-11-11

- Default the initial display mode to bilingual; automatically save changes and restore them after refresh.
- Store display mode separately so configuration saves from other pages or player frames do not overwrite the choice.

### v0.3.0 · 2026-11-11

- Add a background transparency slider with live preview and automatic saving while keeping text opaque.
- Support dragging subtitles, saving relative positions, constraining the box to the video, and restoring its default position.
- Keep the current caption visible during a drag to prevent cue changes from interrupting it.
- Complete automated tests and build checks; browser interaction validation for this version is left to the user.

### v0.2.1 · 2026-11-08

- Fix matching of the downloads panel close control, including non-button elements with `aria-label`.
- Ignore hidden download entries during subtitle discovery.

### v0.2.0 · 2026-11-08

- Add automatic English SRT retrieval and import using the Kaltura downloads panel's existing workflow.
- Add a retrieve-and-translate button and independent automatic retrieval and translation toggles.
- Display the imported filename and cue count; reuse the cache or call the translation service after import.
- Check for ambiguous candidates, timeouts, cancellation, file size, and video changes; retain manual import on failure.
- Validate automatic import of 161 English cues and Google translation on a real course page.

### v0.1.4 · 2026-11-08

- Remove empty subtitle rows while preserving meaningful line breaks, fixing extra gaps between translated Chinese lines.
- Apply display cleanup to cached translations without requiring translation again.

### v0.1.3 · 2026-11-08

- Add update metadata generation and version-check support.
- Read the installation version consistently from `package.json` during builds.

### v0.1.2 · 2026-11-08

- Move the subtitle button's default position to the left, away from the player's upper-right toolbar.
- Support dragging the button, remembering its position, and adapting panel placement to window size.
- Move raw player diagnostics into a collapsed Advanced diagnostics section.

### v0.1.1 · 2026-11-08

- Fix binding to Kaltura's empty standby video, which prevented translated subtitles from appearing.
- Automatically select the single loaded video and detect delayed loading; retain manual selection for multiple valid videos.

### v0.1.0 · 2026-11-08

- Introduce a modular Tampermonkey script supporting Google Cloud Translation Basic v2 and Azure AI Translator.
- Add manual English SRT import, a settings panel, key storage, batch translation, deduplication, caching, and cancellation.
- Implement bilingual, original-only, and translation-only display with synchronization and timing offsets.
- Add player diagnostics, iframe compatibility notes, and an extensible Provider Adapter interface.

## References

- [Tampermonkey documentation](https://www.tampermonkey.net/documentation.php)
- [Google Cloud Translation v2](https://cloud.google.com/translate/docs/reference/rest/v2/translate)
- [Azure Translator v3](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate)
- [Kaltura downloads plugin](https://github.com/kaltura/playkit-js-downloads)

## License

This project uses the [MIT License](LICENSE). Retain the copyright notice and license text when using, modifying, or distributing it.
