# GitHub File Row Copy

A Tampermonkey userscript that puts an inline copy button directly between GitHub's file icon and filename in repository directory listings.

Clicking the button fetches the file's raw contents and writes them to the clipboard, so there is no need to open the file and use GitHub's separate copy control.

## Behavior

- adds the button only to file rows; directory rows are left alone
- converts the row's existing `/blob/` URL to GitHub's `/raw/` route
- sends the request with the existing GitHub browser session rather than requiring a GitHub API token
- uses `GM_setClipboard` so copying still works after the asynchronous fetch
- shows a short success/error state on the button
- watches GitHub's dynamic navigation and React rerenders so buttons are restored when the file list changes
- caches successfully fetched file text for the lifetime of the page

## Install

Open [`github-file-copy.user.js`](./github-file-copy.user.js) and use **Raw**, or install directly from:

`https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/github-file-copy/github-file-copy.user.js`

Tampermonkey should recognize the `.user.js` metadata block and offer to install it.

## Scope

The script matches `github.com` repository pages and only modifies the current repository file-list rows. It does not add controls to folders, issue lists, pull-request files, or the file viewer itself.
