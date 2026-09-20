// ==UserScript==
// @name         Make a text selectable in Practice
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://www.duolingo.com/*
// @homepage      https://userstyles.org/styles/152853
// @icon         https://www.google.com/s2/favicons?domain=duolingo.com
// @require https://ajax.googleapis.com/ajax/libs/jquery/3.4.0/jquery.min.js
// @grant        none
// ==/UserScript==

/* globals $, jQuery */
'use strict';
console.log('hi :)');
let clipped = [];
let obj = null;

function copyTextToClipboard(text)
{
    console.log('copy');
    navigator.clipboard.writeText(text)
        .then(
        function ()
        {
            clipped.push(text);
            console.log('Async: Copying to clipboard was successful!');
        },
        function (err)
        {
            console.error('Async: Could not copy text: ', err);
        }
    );
}

function payload()
{
    console.log('Exec...');
    if (window.location.href.startsWith('https://www.duolingo.com/practice'))
    {
        console.log('Found location');
        const s = "textarea";
        const area = $(s);
        if (obj && obj != area)
        {
            console.log('focused');
            obj = area;
            area.focus();
        }

        const text = $('[data-test="hint-token"]');
        if (text.length > 0)
        {
            console.log(text);
            const content = text.toArray().map(s => s.textContent).join('');
            const lastIdx = clipped.length - 1;
            const firstIdx = lastIdx - 1;

            if (lastIdx > -1 && firstIdx > -1 && clipped[lastIdx] !== content && clipped[firstIdx] !== content)
            {
                console.log('\t', text);
                copyTextToClipboard(content);
            }
        }
    }
}

setInterval(async()=>
     await navigator.clipboard.writeText($('[data-test="hint-token"]').toArray().map(s => s.innerText.trim()).join('')), 1000)
