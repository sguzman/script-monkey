// ==UserScript==
// @name         Backloggd Library CSV Exporter
// @namespace    https://github.com/sguzman/script-monkey
// @version      1.0.0
// @description  Export a Backloggd profile library to CSV from your logged-in browser session.
// @author       sguzman
// @match        https://backloggd.com/u/*/games*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

'use strict';

(() => {
    const REQUEST_DELAY_MS = 400;
    const MAX_PAGES_PER_VIEW = 100;
    const LIBRARY_VIEWS = ['played', 'playing', 'backlog', 'wishlist'];
    const PLAY_STATUSES = new Set(['Played', 'Completed', 'Retired', 'Shelved', 'Abandoned']);

    let exporting = false;
    let button = null;

    function profileContext() {
        const match = window.location.pathname.match(/^\/u\/([^/]+)\/games/);
        if (!match) {
            throw new Error('Open a Backloggd profile games page first.');
        }

        const username = decodeURIComponent(match[1]);
        return {
            username,
            baseUrl: `${window.location.origin}/u/${encodeURIComponent(username)}/games`,
        };
    }

    function candidateViewUrls(baseUrl, view) {
        return [
            `${baseUrl}/added/type:${view}`,
            `${baseUrl}/type:${view}`,
            `${baseUrl}/${view}`,
        ];
    }

    async function fetchDocument(url) {
        const response = await fetch(url, {
            credentials: 'include',
            headers: { Accept: 'text/html,application/xhtml+xml' },
        });

        if (!response.ok) {
            return null;
        }

        const html = await response.text();
        return new DOMParser().parseFromString(html, 'text/html');
    }

    function gameCards(documentRoot) {
        const ratingCards = documentRoot.querySelectorAll('.rating-hover');
        if (ratingCards.length) {
            return [...ratingCards];
        }

        return [...documentRoot.querySelectorAll('.card.game-cover')];
    }

    function nextPageUrl(documentRoot) {
        const link = documentRoot.querySelector(
            'a[aria-label="Next"], a[rel="next"], .pagination a.next_page'
        );
        return link?.getAttribute('href') || null;
    }

    function canonicalGameUrl(card) {
        const href = card.querySelector('a[href*="/games/"]')?.getAttribute('href');
        if (!href) {
            return '';
        }

        try {
            return new URL(href, window.location.origin).href;
        } catch {
            return href;
        }
    }

    function parseRating(card) {
        const raw = Number.parseFloat(card.querySelector('[data-rating]')?.getAttribute('data-rating') ?? '');
        if (Number.isFinite(raw) && raw > 0) {
            return Number((raw / 2).toFixed(2));
        }

        const style = card.querySelector('.stars-top')?.getAttribute('style') || '';
        const width = style.match(/width:\s*([\d.]+)%/i);
        if (!width) {
            return '';
        }

        const rating = Number.parseFloat(width[1]) / 20;
        return rating > 0 ? Number(rating.toFixed(2)) : '';
    }

    function parsePlayStatus(card) {
        const explicit = card.querySelector('[data-status-title]')
            ?.getAttribute('data-status-title')
            ?.trim();
        if (explicit && PLAY_STATUSES.has(explicit)) {
            return explicit;
        }

        const raw = card.querySelector('.played-btn-container button[play_type], [play_type]')
            ?.getAttribute('play_type')
            ?.trim();
        if (!raw) {
            return '';
        }

        const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        return PLAY_STATUSES.has(normalized) ? normalized : '';
    }

    function parseCard(card) {
        const title = (
            card.querySelector('img.card-img')?.getAttribute('alt') ||
            card.querySelector('.game-text-centered')?.textContent ||
            card.querySelector('img')?.getAttribute('alt') ||
            ''
        ).trim();

        if (!title) {
            return null;
        }

        const gameId = (
            card.querySelector('[game_id]')?.getAttribute('game_id') ||
            card.getAttribute('game_id') ||
            ''
        ).trim();

        return {
            gameId,
            title,
            rating: parseRating(card),
            playStatus: parsePlayStatus(card),
            url: canonicalGameUrl(card),
        };
    }

    function mergeGame(games, parsed, view) {
        const key = parsed.gameId || parsed.url || `title:${parsed.title}`;
        const existing = games.get(key) || {
            gameId: parsed.gameId,
            title: parsed.title,
            rating: '',
            playStatus: '',
            url: parsed.url,
            views: new Set(),
        };

        if (parsed.rating !== '') existing.rating = parsed.rating;
        if (parsed.playStatus) existing.playStatus = parsed.playStatus;
        if (parsed.url) existing.url = parsed.url;
        existing.views.add(view);
        games.set(key, existing);
    }

    function resolvedStatus(game) {
        if (PLAY_STATUSES.has(game.playStatus)) return game.playStatus;
        if (game.views.has('playing')) return 'Playing';
        if (game.views.has('wishlist')) return 'Wishlist';
        return '';
    }

    function csvCell(value) {
        const text = String(value ?? '');
        if (!/[",\r\n]/.test(text)) return text;
        return `"${text.replace(/"/g, '""')}"`;
    }

    function toCsv(games) {
        const rows = [[
            'Title',
            'Rating',
            'Status',
            'Backlog',
            'Game ID',
            'Backloggd URL',
        ]];

        const sorted = [...games.values()].sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
        );

        for (const game of sorted) {
            rows.push([
                game.title,
                game.rating,
                resolvedStatus(game),
                game.views.has('backlog') ? 'Yes' : '',
                game.gameId,
                game.url,
            ]);
        }

        return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    }

    function downloadCsv(username, csv) {
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `backloggd_${username}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function setButtonState(text, disabled = false) {
        if (!button) return;
        button.textContent = text;
        button.disabled = disabled;
        button.style.opacity = disabled ? '0.7' : '1';
        button.style.cursor = disabled ? 'wait' : 'pointer';
    }

    function sleep(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    async function scrapeView(games, baseUrl, view) {
        let documentRoot = null;
        let currentUrl = '';

        for (const url of candidateViewUrls(baseUrl, view)) {
            const candidate = await fetchDocument(url);
            if (candidate && gameCards(candidate).length) {
                documentRoot = candidate;
                currentUrl = url;
                break;
            }
        }

        if (!documentRoot) {
            console.info(`[Backloggd Export] No ${view} games found.`);
            return;
        }

        let page = 1;
        let previousSignature = '';

        while (documentRoot && page <= MAX_PAGES_PER_VIEW) {
            const cards = gameCards(documentRoot);
            if (!cards.length) break;

            const pageTitles = [];
            for (const card of cards) {
                const parsed = parseCard(card);
                if (!parsed) continue;
                pageTitles.push(parsed.title);
                mergeGame(games, parsed, view);
            }

            setButtonState(`Exporting ${view}… ${games.size}`, true);
            console.info(`[Backloggd Export] ${view} page ${page}: ${cards.length} cards; ${games.size} unique games.`);

            const signature = pageTitles.join('\u001f');
            if (signature && signature === previousSignature) break;
            previousSignature = signature;

            const nextHref = nextPageUrl(documentRoot);
            if (!nextHref) break;

            currentUrl = new URL(nextHref, currentUrl || window.location.origin).href;
            page += 1;
            await sleep(REQUEST_DELAY_MS);
            documentRoot = await fetchDocument(currentUrl);
        }
    }

    async function exportLibrary() {
        if (exporting) return;
        exporting = true;
        setButtonState('Starting export…', true);

        try {
            const { username, baseUrl } = profileContext();
            const games = new Map();

            for (const view of LIBRARY_VIEWS) {
                await scrapeView(games, baseUrl, view);
            }

            if (!games.size) {
                throw new Error('No games were found. Make sure you are logged in and on your Backloggd games page.');
            }

            const csv = toCsv(games);
            downloadCsv(username, csv);
            setButtonState(`Exported ${games.size} games ✓`);
            console.info(`[Backloggd Export] Exported ${games.size} games for ${username}.`);
            window.setTimeout(() => setButtonState('Export games CSV'), 2500);
        } catch (error) {
            console.error('[Backloggd Export]', error);
            setButtonState('Export failed — click to retry');
            window.alert(`Backloggd export failed: ${error.message || error}`);
        } finally {
            exporting = false;
        }
    }

    function installButton() {
        if (document.getElementById('sg-backloggd-export')) return;

        button = document.createElement('button');
        button.id = 'sg-backloggd-export';
        button.type = 'button';
        button.textContent = 'Export games CSV';
        button.addEventListener('click', exportLibrary);
        Object.assign(button.style, {
            position: 'fixed',
            right: '18px',
            bottom: '18px',
            zIndex: '2147483647',
            padding: '10px 14px',
            border: '1px solid rgba(255,255,255,.25)',
            borderRadius: '8px',
            background: '#222',
            color: '#fff',
            font: '600 13px/1.2 system-ui, sans-serif',
            boxShadow: '0 4px 18px rgba(0,0,0,.35)',
            cursor: 'pointer',
        });
        document.body.appendChild(button);
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Export Backloggd library to CSV', exportLibrary);
    }

    installButton();
})();
