import {readFile,writeFile,mkdir} from 'node:fs/promises';
const {version}=JSON.parse(await readFile('package.json','utf8'));
const header=`// ==UserScript==
// @name         Canvas / Kaltura Bilingual Subtitles
// @namespace    local.canvas-bilingual
// @version      ${version}
// @updateURL    http://127.0.0.1:8765/canvas-bilingual.meta.js
// @downloadURL  http://127.0.0.1:8765/canvas-bilingual.user.js
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
`;
const files=['subtitles','providers','translation','player','floating-ui','auto-subtitles','main'];
const source=(await Promise.all(files.map(f=>readFile(`src/${f}.js`,'utf8')))).map(s=>s.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
await mkdir('dist',{recursive:true});
await writeFile('dist/canvas-bilingual.user.js',header+'\n(function(){\n"use strict";\n'+source+'\n})();\n');

await writeFile('dist/canvas-bilingual.meta.js',header);
