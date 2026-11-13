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
- Sidebar: jump to and focus on a section (Ctrl+click to focus on several), saved filters, named styles,
  and every Find match.
- Filters: by text, by checkbox, and by column values (Owner contains, Due in the next 7 days,
  Estimate > 2h...). Save them in the sidebar and edit them later (Ctrl+Shift+G).
- Focus on the selected sections (Ctrl+Shift+F), Find and Replace with all results listed in the sidebar.
- Attach files by dragging them onto a row; images show inline and resize by dragging the corner.
- Record audio into a row (Ctrl+Shift+R); it plays in the outline and is saved next to the file.
- Links to a row (`arbor://` links, Edit > Copy Link to Row).
- Writing modes: distraction-free (Ctrl+Shift+D, with a word count), typewriter scrolling
  (Ctrl+Shift+T) and folded editing (Ctrl+Shift+E), where rows you are not editing show one line.
- Quick Add from any app (Ctrl+Alt+Space while Arbor is running): type a row and press Enter; it goes to an
  open outline or straight into a recent outline file.
- Due dates: date columns remind you (a Windows notification once a day) about rows that are due or overdue,
  overdue dates show in red, and the sidebar has a Due or overdue filter. Turn reminders off per column
  (Columns tab) or entirely (View > Due Date Reminders).
- Customisable keyboard shortcuts for every menu command, and for Quick Add (Help > Keyboard Shortcuts).
- Several windows, including a second window on the same outline (View > New Window on This Outline).
- Automation console with a small JavaScript API (Automation menu).
- OPML mode: an .opml file opens and saves as OPML, so other outliners can keep using it.
- Coming from OmniOutliner: open .ooutline and .oo3 documents directly (File > Import > OmniOutliner), including
  Mac package folders. Rows, notes, checkboxes and extra columns come across; styles and attachments do not.
- Open and import OPML, Markdown, plain text, RTF, Word (headings and lists become rows, tables become
  columns), PowerPoint (a row per slide, bullets inside it, speaker notes as its note), Excel and CSV
  (Level, Status and Note columns are understood); export OPML, Markdown, text, RTF,
  Excel, Word, PowerPoint, HTML, CSV and PDF; print.
- Saves automatically once a file has a name; undo and redo for every change;
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
