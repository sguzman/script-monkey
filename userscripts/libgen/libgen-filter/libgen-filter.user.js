// ==UserScript==
// @name         Libgen Filter
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Filter libgen search results by extension, language, title, etc.
// @author       You
// @match        *://libgen.is/*
// @match        *://*.libgen.is/*
// @match        *://libgen.rs/*
// @match        *://*.libgen.rs/*
// @match        *://libgen.st/*
// @match        *://*.libgen.st/*
// @match        *://libgen.li/*
// @match        *://*.libgen.li/*
// @match        *://libgen.gs/*
// @match        *://*.libgen.gs/*
// @match        *://libgen.lc/*
// @match        *://*.libgen.lc/*
// @match        *://gen.lib.rus.ec/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Only inject UI if we are on a page with search results
    if (!window.location.search.includes('req=')) return;

    // 1. Create UI
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '10px';
    container.style.right = '10px';
    container.style.backgroundColor = 'white';
    container.style.border = '1px solid #ccc';
    container.style.padding = '10px';
    container.style.zIndex = '9999';
    container.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    container.style.fontFamily = 'sans-serif';
    container.style.fontSize = '14px';
    container.style.borderRadius = '5px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';

    const header = document.createElement('div');
    header.innerText = 'Libgen Filters';
    header.style.fontWeight = 'bold';
    header.style.textAlign = 'center';
    header.style.marginBottom = '5px';
    container.appendChild(header);

    const createInputGroup = (labelText) => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.justifyContent = 'space-between';
        label.style.alignItems = 'center';
        label.innerText = labelText + ': ';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.style.marginLeft = '10px';
        input.style.width = '120px';
        
        label.appendChild(input);
        container.appendChild(label);
        
        return input;
    };

    const titleInput = createInputGroup('Title');
    const langInput = createInputGroup('Language');
    const extInput = createInputGroup('Extension');

    document.body.appendChild(container);

    // 2. Filter logic
    function applyFilters() {
        const titleFilter = titleInput.value.toLowerCase();
        const langFilter = langInput.value.toLowerCase();
        const extFilter = extInput.value.toLowerCase();

        // Find the main search results table
        let mainTable = null;
        let titleCol = 2, langCol = 6, extCol = 8; // Defaults

        const tables = document.querySelectorAll('table');
        for (const t of tables) {
            const firstRow = t.querySelector('tr');
            if (firstRow && firstRow.innerText.toLowerCase().includes('extension')) {
                mainTable = t;
                const headers = Array.from(firstRow.querySelectorAll('th, td')).map(cell => cell.innerText.toLowerCase());
                if (headers.length > 0) {
                    const extIdx = headers.findIndex(h => h.includes('extension') || h.includes('ext'));
                    const langIdx = headers.findIndex(h => h.includes('language') || h.includes('lang'));
                    const titleIdx = headers.findIndex(h => h.includes('title'));
                    if (extIdx !== -1) extCol = extIdx;
                    if (langIdx !== -1) langCol = langIdx;
                    if (titleIdx !== -1) titleCol = titleIdx;
                }
                break;
            }
        }

        if (!mainTable) return;
        
        const rows = Array.from(mainTable.querySelectorAll('tr')).slice(1); // skip header row

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length <= Math.max(titleCol, langCol, extCol)) return;

            const title = cells[titleCol] ? cells[titleCol].innerText.toLowerCase() : '';
            const lang = cells[langCol] ? cells[langCol].innerText.toLowerCase() : '';
            const ext = cells[extCol] ? cells[extCol].innerText.toLowerCase() : '';

            let show = true;
            if (titleFilter && !title.includes(titleFilter)) show = false;
            if (langFilter && !lang.includes(langFilter)) show = false;
            if (extFilter && !ext.includes(extFilter)) show = false;

            row.style.display = show ? '' : 'none';
        });
    }

    titleInput.addEventListener('input', applyFilters);
    langInput.addEventListener('input', applyFilters);
    extInput.addEventListener('input', applyFilters);
})();
