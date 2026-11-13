# Arbor Outliner

An outliner for Windows. Organise ideas in rows that nest as deep as you like, with
notes, checkboxes, extra columns, styles, focus and filters.

## Install

Download `Arbor-Outliner-Setup-x.y.z.exe` from the
[latest release](https://github.com/c0linzeal/arbor-outliner/releases/latest) and run it.
Windows may show a SmartScreen warning because the installer is not code-signed:
choose **More info**, then **Run anyway**.

The app checks for updates when it starts and every few hours. New versions download in
the background and install when you restart. **Help > Check for Updates** checks now.

## What it does

- Rows with unlimited levels: Enter for a new row, Tab and Shift+Tab to move right and left,
  Ctrl+Shift+Up/Down to move rows, drag the bullet to drag and drop.
- Collapse and expand (click the triangle, or Alt+Left/Right).
- Checkboxes on every row; parents show checked, unchecked or mixed.
- Notes under any row (Ctrl+').
- Columns: text, number, duration (`1d 2h 30m`), date, checkbox and pop-up list,
  with totals, averages, minimum, maximum, earliest or latest on parent rows. Sort by any column.
- Styles: whole document, per level, named styles (Highlight, Emphasis...) and per row
  (bold, italic, underline, strikethrough, colours, size).
- Row numbering (I. A. 1. a., 1.1.1, or 1. on each level).
- Themes (Standard, Paper, Ocean, Forest, Mono) that follow Windows light and dark mode,
  or can be forced light or dark.
- Sidebar: jump to and focus on a section, saved filters, named styles.
- Filter by text or by checkbox, Focus on a section (Ctrl+Shift+F), Find and Replace.
- Attach files by dragging them onto a row; images show inline.
- Links to a row (`arbor://` links, Edit > Copy Link to Row).
- Distraction-free mode (Ctrl+Shift+D).
- Automation console with a small JavaScript API (Automation menu).
- Open and import OPML, Markdown and plain text; export OPML, Markdown, text, HTML, CSV and PDF; print.
- Saves automatically once a file has a name; undo and redo for every change; several windows;
  reopens the outlines you had open last time; spell check.
- Templates: To-Do List, Meeting Notes, Budget, Project Plan, Essay Outline.

Help > Keyboard Shortcuts lists every shortcut.

## For developers

```
npm install
npm start            # run from source
npm test             # model tests + an end-to-end run of the real window
npm run dist         # build the installer into release/
```

### Publishing an update

1. Change `version` in `package.json` (for example to `1.0.1`) and commit.
2. Tag and push: `git tag v1.0.1 && git push && git push --tags`.
3. GitHub Actions builds the installer and publishes the release. Installed copies update themselves.
