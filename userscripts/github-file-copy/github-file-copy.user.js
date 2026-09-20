// ==UserScript==
// @name         GitHub File Row Copy
// @namespace    https://github.com/sguzman/script-monkey
// @version      1.0.1
// @description  Copy a repository file directly from GitHub directory listings without opening it first.
// @author       sguzman
// @match        https://github.com/*/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      github.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

'use strict';

(() => {
    const BUTTON_CLASS = 'sg-github-file-copy-button';
    const STYLE_ID = 'sg-github-file-copy-style';
    const contentCache = new Map();

    const ICON_COPY = `
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
        </svg>`;

    const ICON_CHECK = `
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
        </svg>`;

    const ICON_ERROR = `
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path>
        </svg>`;

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${BUTTON_CLASS} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 auto;
                width: 18px;
                height: 18px;
                margin: 0 2px 0 4px;
                padding: 0;
                border: 0;
                border-radius: 4px;
                background: transparent;
                color: var(--fgColor-muted, var(--color-fg-muted, #59636e));
                cursor: pointer;
                line-height: 1;
            }

            .${BUTTON_CLASS}:hover {
                background: var(--control-transparent-bgColor-hover, var(--color-neutral-muted, rgba(175, 184, 193, 0.2)));
                color: var(--fgColor-accent, var(--color-accent-fg, #0969da));
            }

            .${BUTTON_CLASS}:focus-visible {
                outline: 2px solid var(--focus-outlineColor, var(--color-accent-fg, #0969da));
                outline-offset: 1px;
            }

            .${BUTTON_CLASS}[data-state="busy"] {
                cursor: wait;
                opacity: 0.65;
            }

            .${BUTTON_CLASS}[data-state="success"] {
                color: var(--fgColor-success, var(--color-success-fg, #1a7f37));
            }

            .${BUTTON_CLASS}[data-state="error"] {
                color: var(--fgColor-danger, var(--color-danger-fg, #cf222e));
            }
        `;
        document.head.appendChild(style);
    }

    function rawUrlFromBlobHref(blobHref) {
        const url = new URL(blobHref, window.location.origin);
        const marker = '/blob/';
        const markerIndex = url.pathname.indexOf(marker);

        if (markerIndex < 0) {
            throw new Error('Could not derive a raw GitHub URL for this file.');
        }

        url.pathname = `${url.pathname.slice(0, markerIndex)}/raw/${url.pathname.slice(markerIndex + marker.length)}`;
        url.search = '';
        url.hash = '';
        return url.href;
    }

    async function fetchFileText(blobHref) {
        if (contentCache.has(blobHref)) {
            return contentCache.get(blobHref);
        }

        const rawUrl = rawUrlFromBlobHref(blobHref);
        const text = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: rawUrl,
                headers: {
                    Accept: 'text/plain,*/*;q=0.9',
                },
                responseType: 'text',
                onload(response) {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText);
                        return;
                    }

                    reject(new Error(`GitHub returned HTTP ${response.status}.`));
                },
                onerror() {
                    reject(new Error('GitHub raw-file request failed.'));
                },
                ontimeout() {
                    reject(new Error('GitHub raw-file request timed out.'));
                },
            });
        });

        contentCache.set(blobHref, text);
        return text;
    }

    function setButtonState(button, state, message = '') {
        button.dataset.state = state;

        if (state === 'success') {
            button.innerHTML = ICON_CHECK;
            button.title = 'Copied file contents';
            button.setAttribute('aria-label', 'Copied file contents');
            return;
        }

        if (state === 'error') {
            button.innerHTML = ICON_ERROR;
            button.title = message || 'Could not copy file contents';
            button.setAttribute('aria-label', button.title);
            return;
        }

        if (state === 'busy') {
            button.innerHTML = ICON_COPY;
            button.title = 'Copying file contents…';
            button.setAttribute('aria-label', 'Copying file contents');
            return;
        }

        button.innerHTML = ICON_COPY;
        button.title = 'Copy file contents';
        button.setAttribute('aria-label', 'Copy file contents');
    }

    async function copyFile(button, blobHref) {
        if (button.dataset.state === 'busy') {
            return;
        }

        button.disabled = true;
        setButtonState(button, 'busy');

        try {
            const text = await fetchFileText(blobHref);
            GM_setClipboard(text, 'text');
            setButtonState(button, 'success');
        } catch (error) {
            console.error('[GitHub File Row Copy]', error);
            setButtonState(button, 'error', error instanceof Error ? error.message : String(error));
        } finally {
            window.setTimeout(() => {
                button.disabled = false;
                setButtonState(button, 'idle');
            }, 1400);
        }
    }

    function directFilenameChild(column, fileLink) {
        const overflowContainer = fileLink.closest('.overflow-hidden');
        if (overflowContainer?.parentElement === column) {
            return overflowContainer;
        }

        return [...column.children].find((child) => child.contains(fileLink)) || null;
    }

    function enhanceDirectoryRows() {
        injectStyle();

        document.querySelectorAll('.react-directory-row .react-directory-filename-column').forEach((column) => {
            if (column.querySelector(`:scope > .${BUTTON_CLASS}`)) {
                return;
            }

            const fileLink = column.querySelector('a[href*="/blob/"]');
            if (!fileLink) {
                return;
            }

            const filenameChild = directFilenameChild(column, fileLink);
            if (!filenameChild) {
                return;
            }

            const button = document.createElement('button');
            button.type = 'button';
            button.className = BUTTON_CLASS;
            button.dataset.state = 'idle';
            setButtonState(button, 'idle');

            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                void copyFile(button, fileLink.href);
            });

            column.insertBefore(button, filenameChild);
        });
    }

    let scanScheduled = false;
    function scheduleScan() {
        if (scanScheduled) {
            return;
        }

        scanScheduled = true;
        window.requestAnimationFrame(() => {
            scanScheduled = false;
            enhanceDirectoryRows();
        });
    }

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    document.addEventListener('turbo:load', scheduleScan);
    document.addEventListener('pjax:end', scheduleScan);
    window.addEventListener('popstate', scheduleScan);

    scheduleScan();
})();
