// ==UserScript==
// @name         Canvas / Kaltura Bilingual Subtitles
// @namespace    local.canvas-bilingual
// @license      MIT
// @version      0.3.4
// @updateURL    https://github.com/YujunGit/canvas-bilingual-subtitles/releases/latest/download/canvas-bilingual.user.js
// @downloadURL  https://github.com/YujunGit/canvas-bilingual-subtitles/releases/latest/download/canvas-bilingual.user.js
// @description  Inspect player, import SRT, translate with Google v2 or Azure
// @match        https://*.instructure.com/*
// @match        https://cdnapisec.kaltura.com/*
// @match        https://*.mediaspace.kaltura.com/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      translation.googleapis.com
// @connect      api.cognitive.microsofttranslator.com
// @run-at       document-idle
// ==/UserScript==
