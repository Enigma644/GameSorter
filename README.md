# Game Sorter

## ▶ Use it now: https://enigma644.github.io/GameSorter/

Enter the size of your board game boxes and your shelves, then arrange the games by hand or let the auto-sorter pack them onto as few shelves as it can.

It is a single web page that runs entirely in the browser. There is no server side, no build step and no account: your collection is kept in the browser's local storage and can be saved to and loaded from a spreadsheet.

## Running it

The easiest way is the hosted copy at https://enigma644.github.io/GameSorter/.

To run your own copy, open `index.html` in a browser, or serve the folder from any static web server. Nothing needs installing.

It is built for a desktop browser with a mouse. Touch screens are not supported yet.

## Using it

- **Games and shelves** are defined by a name (optional) and a width, height and depth in centimetres. Shelves are grouped into bookcases: every shelf in a bookcase has the same width and depth, each has its own height, and a bookcase can have several identical columns side by side. The default is two IKEA BILLY bookcases, a low one with three shelves and a tall one with six, each shelf 76.3 × 30 × 26.5 cm (width × height × depth).
- **Unsorted games** sit to either side of the shelving. Drag them onto a shelf and they drop with gravity and stack.
- **Double-click** a game or a bookcase to edit it. The game editor shows the box in 3D and can rotate it.
- **Drag a bookcase by its title** to reorder the bookcases left to right.
- **Locking a shelf** (the padlock in its corner) fixes everything on it: its games cannot be moved, nothing can be added to it, and auto-sort, Unshelve Unlocked and Clear all leave it alone.
- **Lock in place** stops the auto-sorter moving a game. **This side up** stops it tipping a game over (it may still turn it on the shelf).
- **2D / 3D** switches between two drawings of the same layout: flat from the front, or as solid boxes at an angle. Boxes can sit in front of each other in either view. The eye button in the corner of each shelf opens a top-down view for arranging it front to back; it sizes itself to the window and has its own zoom.
- **Import / Export** loads and saves the collection as a spreadsheet. **Reset** goes back to the sample collection. **Clear** removes every game that is not locked in place and keeps the shelving, ready for your own collection.

### Rules

| Rule                                                                                        | Placing by hand            | Auto-sort |
|---------------------------------------------------------------------------------------------|----------------------------|-----------|
| A box must fit within the width and height of its shelf                                     | Enforced                   | Enforced  |
| Shelf has **Overhang** unticked: nothing may stick out past its front                       | Enforced                   | Enforced  |
| Unstable: less than half of a box's underside is supported                                  | Allowed, flagged in orange | Never     |
| Overhang: a box sticks out past the front by more than the bookcase's limit (default 10 cm) | Allowed, flagged in orange | Never     |
| Hidden: less than half of a box's front can be seen past the boxes in front of it           | Allowed                    | Never     |

### Auto-sort

The **Auto-Sort** button offers two choices. **Sort everything** takes every unlocked game off the shelves and rearranges them all. **Sort unsorted only** leaves the shelved games where they are and fits the unsorted ones in around them, so you can place some games by hand and let the sorter do the rest without locking anything.

Either way it turns boxes any way up that is allowed, and shows each layout as it tries it. It keeps the best layout it finds, judged in this order:

1. the most games shelved
2. the fewest shelves used
3. the fewest boxes standing in front of other boxes
4. the least broken-up empty space
5. the least total overhang

It fills shelves that already hold games that are staying put first, then each bookcase from the bottom shelf up. Bigger boxes go at the bottom of stacks, and a box only goes in front of others if it is no bigger than them and leaves at least half of each one's front visible. Games that fit nowhere are left unsorted. A sort stops after 12 seconds at most.

## Spreadsheet format

Export writes `GameSorter.xlsx` with two sheets, listing the games alphabetically. Import accepts `.xlsx`, `.xls` or `.csv`; a CSV holds one sheet, so it is read as either games or shelves according to its column headers.

For games, only **Width**, **Height** and **Depth** are required; for shelves, a **Width** and **Depth** for the bookcase and a **Height** for each shelf. Header matching ignores case and spacing. Importing replaces only what the file contains: a file with just a games sheet keeps the current bookcases.

**Games**

| Column               | Meaning                                                                                             |
|----------------------|-----------------------------------------------------------------------------------------------------|
| Name                 | Optional                                                                                            |
| Width, Height, Depth | Centimetres, as the box currently stands                                                            |
| This Side Up         | TRUE if the box must not be tipped over                                                             |
| Lock In Place        | TRUE if auto-sort must not move it                                                                  |
| Bookcase, Column, Shelf | Where it is shelved: bookcase number from the left, column number from the left, shelf number from the top. Blank if unsorted. Column can be left out for single-column bookcases |
| X, Y, Z              | Position on the shelf in cm: from its left side, from its floor, and from its back wall             |

**Shelves** (one row per shelf of a column, top to bottom)

| Column | Meaning |
|---|---|
| Bookcase | Bookcase number from the left. Rows with the same number form one bookcase |
| Bookcase Name | Optional |
| Columns | How many identical columns the bookcase has side by side. Default 1 |
| Width, Depth | Centimetres. The same for every shelf in the bookcase |
| Max Overhang | How far, in cm, a box may stick out before it is flagged. Default 10 |
| Shelf Name | Optional |
| Height | Centimetres, for this shelf |
| Allow Overhang | FALSE if nothing may stick out past the front of this shelf, for example behind doors |
| Locked | TRUE if this shelf is locked. In a bookcase with several columns, TRUE locks it in every column, or list the column numbers, for example `1, 3` |

Columns, Width, Depth and Max Overhang describe the whole bookcase and are read from its first row; they can be left blank on the rest. Files in the older layout, with a width and depth on every row and no Columns, still import.

## Project layout

| Path            | Contents                                                     |
|-----------------|--------------------------------------------------------------|
| `index.html`    | The page and its dialogs                                     |
| `css/style.css` | All styling, including the 3D drawing                        |
| `js/app.js`     | The whole application; its header comment lists the sections |
| `js/vendor/`    | SheetJS, used for reading and writing spreadsheets           |
| `tests/`        | Browser tests for sorting, stability and import/export       |

## Tests

```
bash tests/run.sh          # every suite
bash tests/run.sh sort     # one suite
```

The runner needs Git Bash on Windows, Python 3 and Microsoft Edge. It loads each `*.test.js` into a temporary copy of the real page in headless Edge and prints a PASS/FAIL report. Dragging with the mouse is not covered by the tests.

## Licence

Copyright © 2026 James Clutterbuck. All rights reserved.

### Third-party software

This project includes [SheetJS Community Edition](https://sheetjs.com) 0.20.3 (`js/vendor/xlsx.full.min.js`), copyright SheetJS LLC, used under the Apache License 2.0. A copy of that licence is in `js/vendor/SheetJS-LICENSE.txt`.

### Sample data

The sample collection is the highest ranked games on [BoardGameGeek](https://boardgamegeek.com) in October 2026, with box sizes as listed there by its users. Game names are trademarks of their respective publishers.
