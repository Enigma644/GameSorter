"use strict";

// Game Sorter: arrange board game boxes on shelves, by hand or automatically. Everything runs in the browser.
//
// All dimensions are decimal cm. Boxes are drawn front-on: width across, height up, depth into the shelf.
//
// The whole app is this one script, in sections:
//   Model, Persistence, Lookups   the state (bookcases > shelves, games and where each is placed) and saving it
//   Shelf physics, Stability      what fits where, gravity, and the half-supported rule
//   Rendering, Zoom               drawing the state: front-on in 2D, as solids in oblique projection in 3D
//   Dialogs and editors           adding and editing games and bookcases
//   Dragging                      reordering bookcases; moving boxes between the piles and the shelves
//   2D / 3D view, Top view        switching between the two drawings; the top-down view for arranging a shelf front to back
//   Auto-sort                     the packing search
//   Import / export               spreadsheets, via SheetJS (js/vendor)

// ---------- Model ----------

const BILLY_SHELF = { width: 76.3, height: 30, depth: 26.5 };
const BILLY_SHELF_COUNT = 6;
const LOW_BILLY_SHELF_COUNT = 3;

// How far (cm) a box may stick out past the front of a shelf before it is flagged; each bookcase can change it
const DEFAULT_MAX_OVERHANG = 10;

// Tolerance for comparing decimal cm values
const EPS = 1e-6;

// The 3D view draws shelves in an oblique projection: each cm of depth towards the viewer shifts this many cm left and down
const SHEAR = 0.35;

let nextId = 1;

function makeShelf(name, width, height, depth, allowOverhang)
{
    // allowOverhang: boxes deeper than the shelf may stick out the front (untick for shelves behind doors)
    return { id: nextId++, name: name, width: width, height: height, depth: depth, allowOverhang: allowOverhang };
}

// A bookcase is a grid: `columns` side by side, each with the same `count` shelves from top to bottom. Every shelf in
// it has the same width and depth; only the heights differ, row by row. bookcase.shelves holds every compartment,
// one column after another (left to right), each column top to bottom. shelf is { width, height, depth }.
function makeBookcase(name, count, shelf, columns)
{
    const shelves = [];

    columns = columns || 1;

    for (let i = 0; i < count * columns; i++)
    {
        shelves.push(makeShelf("", shelf.width, shelf.height, shelf.depth, true));
    }

    return { id: nextId++, name: name, columns: columns, shelves: shelves, maxOverhang: DEFAULT_MAX_OVERHANG };
}

// How many shelves each column of a bookcase has
function shelvesPerColumn(bookcase)
{
    return bookcase.shelves.length / bookcase.columns;
}

// The shelves of one column (0 is the leftmost), top to bottom
function columnShelves(bookcase, column)
{
    const perColumn = shelvesPerColumn(bookcase);

    return bookcase.shelves.slice(column * perColumn, (column + 1) * perColumn);
}

// Where a shelf is in its bookcase: { bookcase, bookcaseIndex, column, row }, all counted from 0
function locateShelf(shelfId)
{
    for (let b = 0; b < state.bookcases.length; b++)
    {
        const bookcase = state.bookcases[b];
        const index = bookcase.shelves.findIndex(function (shelf)
        {
            return shelf.id === shelfId;
        });

        if (index >= 0)
        {
            const perColumn = shelvesPerColumn(bookcase);

            return { bookcase: bookcase, bookcaseIndex: b, column: Math.floor(index / perColumn), row: index % perColumn };
        }
    }

    return null;
}

// What to call a shelf: its own name, or its position
function shelfLabel(shelfId)
{
    const where = locateShelf(shelfId);
    const shelf = where.bookcase.shelves[where.column * shelvesPerColumn(where.bookcase) + where.row];

    return shelf.name || (where.bookcase.columns > 1 ? "Column " + (where.column + 1) + ", shelf " : "Shelf ") + (where.row + 1);
}

function makeGame(name, width, height, depth)
{
    // placement is null (unsorted) or { shelfId, x, y, z }: x/y in cm from the shelf's bottom-left,
    // z in cm from the back wall to the back of the box
    // locked: the auto-sorter may not move it.
    // rotationLocked: "this side up" - it may be turned on the shelf (width <-> depth) but its height stays its height.
    return {
        id: nextId++, name: name, width: width, height: height, depth: depth,
        locked: false, rotationLocked: false, placement: null
    };
}

const state =
{
    // Bookcases are ordered left to right, shelves top to bottom
    bookcases: [],
    games: [],

    // Which way the shelves are drawn: front-on (2D) or as solids at an angle (3D). The layout itself always has
    // depth, so the 2D view is simply the 3D layout seen from the front.
    view3d: false
};

// What a first visit (or Reset) starts with: a low BILLY to the left of a tall one, and the sample games
function loadDefaults()
{
    nextId = 1;
    state.bookcases =
    [
        makeBookcase("IKEA BILLY", LOW_BILLY_SHELF_COUNT, BILLY_SHELF),
        makeBookcase("IKEA BILLY", BILLY_SHELF_COUNT, BILLY_SHELF)
    ];
    state.games = [];
    state.view3d = false;
    loadSampleGames();
}

function loadSampleGames()
{
    // The 60 highest ranked games on BoardGameGeek (4 October 2026), counting each family of games once by its
    // most owned member (so Dune: Imperium, not Uprising; Gloomhaven, not Frosthaven) and leaving out Crokinole,
    // which is a 76 cm board and not a box. Each is [name, width, height, depth], lying flat with the long
    // side across the shelf.
    // Sizes are BoardGameGeek's listed dimensions for the standard English edition, converted from inches.
    const samples =
    [
        ["Brass: Birmingham", 29.8, 7.9, 29.8],
        ["Ark Nova", 37, 7, 30],
        ["Pandemic Legacy: Season 1", 37.2, 7.6, 27],
        ["Gloomhaven", 40.6, 19.1, 29.2],
        ["Dune: Imperium", 30, 8.2, 30],
        ["Twilight Imperium: Fourth Edition", 43.3, 13.4, 30],
        ["War of the Ring: Second Edition", 40.6, 8.9, 27.9],
        ["Terraforming Mars", 29.7, 7.1, 29.7],
        ["Star Wars: Rebellion", 29.4, 13.6, 29.4],
        ["Spirit Island", 29.2, 7.6, 29.2],
        ["Gaia Project", 36.5, 8, 30],
        ["SETI: Search for Extraterrestrial Intelligence", 37, 7, 25.5],
        ["Slay the Spire: The Board Game", 29.7, 7.1, 29.7],
        ["Twilight Struggle", 31, 5.3, 23.4],
        ["The Castles of Burgundy", 31, 6.7, 21.9],
        ["Through the Ages: A New Story of Civilization", 37, 7.5, 25.5],
        ["7 Wonders Duel", 20.3, 5.1, 20.3],
        ["Great Western Trail", 29.5, 7.5, 29.5],
        ["Eclipse: New Dawn for the Galaxy", 40, 9, 28],
        ["Nemesis", 29.7, 14.5, 29.7],
        ["A Feast for Odin", 31.5, 12, 22.5],
        ["Scythe", 36.5, 9.8, 30],
        ["Clank!: A Deck-Building Adventure", 31, 8, 31],
        ["Concordia", 37.1, 5.6, 27.2],
        ["Lost Ruins of Arnak", 37, 7.5, 25.5],
        ["Sky Team", 25.5, 5, 18.5],
        ["Arkham Horror: The Card Game", 25.4, 5.1, 25.4],
        ["Root", 29, 7, 22.5],
        ["Orléans", 31.7, 7.3, 22.6],
        ["Terra Mystica", 31.5, 9.1, 22.7],
        ["Too Many Bones", 30.2, 7.6, 24.4],
        ["Wingspan", 29.4, 7.6, 29.4],
        ["Mage Knight Board Game", 35.3, 7.6, 25],
        ["Barrage", 31.5, 11.9, 22.6],
        ["Hegemony: Lead Your Class to Victory", 30, 10, 30],
        ["Kanban EV", 39.4, 9, 31.8],
        ["Viticulture Essential Edition", 27, 10.5, 22],
        ["The Crew: The Quest for Planet Nine", 17.7, 3.8, 12.7],
        ["Everdell", 29.7, 7.1, 29.7],
        ["Heat: Pedal to the Metal", 29.7, 10.4, 29.7],
        ["Ticket to Ride Legacy: Legends of the West", 43.5, 10.7, 32],
        ["Marvel Champions: The Card Game", 29.2, 7.6, 25.4],
        ["Harmonies", 24.4, 6.5, 21.4],
        ["Underwater Cities", 32, 7, 23],
        ["Food Chain Magnate", 31.2, 5.8, 22.1],
        ["Cthulhu: Death May Die", 32.3, 12, 32.3],
        ["Pax Pamir: Second Edition", 29.2, 5.3, 21.3],
        ["Age of Innovation", 36.5, 8, 30],
        ["Puerto Rico", 30.6, 6.6, 21.7],
        ["On Mars", 39.5, 8, 31.8],
        ["Cascadia", 24.1, 7.1, 24.1],
        ["Caverna: The Cave Farmers", 31.8, 10.3, 22.7],
        ["Anachrony", 42, 10, 30],
        ["Blood on the Clocktower", 36.5, 8.5, 30],
        ["Oathsworn: Into the Deepwood", 40, 20, 30],
        ["Agricola", 31.8, 7, 22.9],
        ["Obsession", 29.2, 8.9, 29.2],
        ["Grand Austria Hotel", 31.5, 5.6, 22.6],
        ["Blood Rage", 30.9, 10.6, 30.9],
        ["Endeavor: Deep Sea", 32.4, 9.5, 32.4]
    ];

    for (const s of samples)
    {
        state.games.push(makeGame(s[0], s[1], s[2], s[3]));
    }

    // A few start on the shelf, to show the shelved, stacked, locked and "this side up" looks
    // ...in the tall bookcase
    const shelves = state.bookcases[1].shelves;

    const dune = state.games[4];
    dune.placement = { shelfId: shelves[3].id, x: 0, y: 0, z: 0 };
    dune.locked = true;

    // Ark Nova, stacked on top of it
    state.games[1].placement = { shelfId: shelves[3].id, x: 0, y: dune.height, z: 0 };

    const gloomhaven = state.games[3];
    gloomhaven.placement = { shelfId: shelves[5].id, x: 0, y: 0, z: 0 };
    gloomhaven.locked = true;
    gloomhaven.rotationLocked = true;
}

// ---------- Persistence ----------

const STORAGE_KEY = "gameSorter.state";

function saveState()
{
    try
    {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, nextId: nextId, bookcases: state.bookcases, games: state.games, view3d: state.view3d }));
    }
    catch (error)
    {
        // Storage can be unavailable or full (e.g. private windows); the app still works, just without persistence
    }
}

// Returns false when there is nothing usable saved
function loadState()
{
    try
    {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

        if (!saved || !Array.isArray(saved.bookcases) || !Array.isArray(saved.games))
        {
            return false;
        }

        state.bookcases = saved.bookcases;
        state.games = saved.games;
        state.view3d = saved.view3d === true;

        // Bookcases saved by earlier versions have no overhang limit and a single column
        for (const bookcase of state.bookcases)
        {
            if (typeof bookcase.maxOverhang !== "number")
            {
                bookcase.maxOverhang = DEFAULT_MAX_OVERHANG;
            }

            if (!(bookcase.columns >= 1) || bookcase.shelves.length % bookcase.columns !== 0)
            {
                bookcase.columns = 1;
            }
        }

        // Placements saved by early versions have no depth position
        for (const game of state.games)
        {
            if (game.placement)
            {
                game.placement.z = game.placement.z || 0;
            }
        }
        nextId = saved.nextId;
        return true;
    }
    catch (error)
    {
        return false;
    }
}

function resetAll()
{
    if (!confirm("Reset everything back to the default bookcase and sample games? Your current games and shelves will be lost."))
    {
        return;
    }

    loadDefaults();
    render();
    fitScale();
    showMessage("Reset to defaults");
}

// Removes every game that isn't locked in place. Bookcases and locked games stay.
function clearGames()
{
    const removable = state.games.filter(function (game)
    {
        return !game.locked;
    });

    if (removable.length === 0)
    {
        showMessage(state.games.length ? "Nothing to clear: every game is locked in place" : "There are no games to clear");
        return;
    }

    const kept = state.games.length - removable.length;

    if (!confirm("Remove " + removable.length + " game(s) for good? " +
        (kept ? "The " + kept + " locked game(s) and all your shelving stay." : "Your shelving stays.") +
        " This can't be undone, so export first if you want to keep them."))
    {
        return;
    }

    state.games = state.games.filter(function (game)
    {
        return game.locked;
    });

    // Locked games that were resting on removed ones drop
    for (const bookcase of state.bookcases)
    {
        for (const shelf of bookcase.shelves)
        {
            settleShelf(shelf.id);
        }
    }

    render();
    showMessage("Removed " + removable.length + " game(s)");
}

// ---------- Lookups ----------

function findGame(id)
{
    return state.games.find(function (game)
    {
        return game.id === id;
    });
}

function findBookcase(id)
{
    return state.bookcases.find(function (bookcase)
    {
        return bookcase.id === id;
    });
}

function findShelf(id)
{
    for (const bookcase of state.bookcases)
    {
        for (const shelf of bookcase.shelves)
        {
            if (shelf.id === id)
            {
                return shelf;
            }
        }
    }

    return null;
}

function gamesOnShelf(shelfId)
{
    return state.games.filter(function (game)
    {
        return game.placement && game.placement.shelfId === shelfId;
    });
}

// ---------- Shelf physics ----------

function fitsShelf(game, shelf)
{
    const p = game.placement;

    if (p.x < -EPS || p.x + game.width > shelf.width + EPS)
    {
        return false;
    }

    if (p.y < -EPS || p.y + game.height > shelf.height + EPS)
    {
        return false;
    }

    return fitsDepth(game, shelf, p.z);
}

// With overhang allowed a box may stick out the front, as long as it is pushed right back or at least half on the shelf
function fitsDepth(game, shelf, z)
{
    if (z < -EPS)
    {
        return false;
    }

    if (shelf.allowOverhang)
    {
        return z < EPS || z + game.depth / 2 <= shelf.depth + EPS;
    }

    return z + game.depth <= shelf.depth + EPS;
}

// The furthest forward (largest z) a box may be placed on a shelf
function maxDepthOffset(game, shelf)
{
    return Math.max(0, shelf.depth - (shelf.allowOverhang ? game.depth / 2 : game.depth));
}

function bookcaseOfShelf(shelfId)
{
    return state.bookcases.find(function (bookcase)
    {
        return bookcase.shelves.some(function (shelf)
        {
            return shelf.id === shelfId;
        });
    });
}

// True when a box at depth z would stick out past the front of the shelf by more than its bookcase allows.
// Like instability, this is allowed when placing by hand but flagged; the auto-sorter never does it.
function sticksOutTooFar(game, shelf, z)
{
    return z + game.depth - shelf.depth > bookcaseOfShelf(shelf.id).maxOverhang + EPS;
}

function maxShelfDepth()
{
    let deepest = 0;

    for (const bookcase of state.bookcases)
    {
        for (const shelf of bookcase.shelves)
        {
            deepest = Math.max(deepest, shelf.depth);
        }
    }

    return deepest;
}

function overlapsUp(a, b)
{
    return a.placement.y < b.placement.y + b.height - EPS && b.placement.y < a.placement.y + a.height - EPS;
}

function overlapsDeep(a, b)
{
    return a.placement.z < b.placement.z + b.depth - EPS && b.placement.z < a.placement.z + a.depth - EPS;
}

// Seen from above
function overlapsFootprint(a, b)
{
    return overlapsAcross(a, b) && overlapsDeep(a, b);
}

// True when the box stands in front of another one and hides at least part of it from the front
function blocksView(game)
{
    return gamesOnShelf(game.placement.shelfId).some(function (other)
    {
        return other !== game && other.placement.z < game.placement.z - EPS &&
            overlapsAcross(game, other) && overlapsUp(game, other);
    });
}

function overlapsAcross(a, b)
{
    return a.placement.x < b.placement.x + b.width - EPS && b.placement.x < a.placement.x + a.width - EPS;
}

function overlaps(a, b)
{
    return overlapsFootprint(a, b) && overlapsUp(a, b);
}

// ---------- Stability ----------

// At least this much of a box's underside has to rest on something for it to count as stable
const MIN_SUPPORT = 0.5;

// Boxes are compared as plain { x, y, z, w, h, d } blocks here, so the auto-sorter can test layouts it hasn't applied
function blockOf(game)
{
    return { x: game.placement.x, y: game.placement.y, z: game.placement.z, w: game.width, h: game.height, d: game.depth, game: game };
}

function overlapLength(startA, lengthA, startB, lengthB)
{
    return Math.max(0, Math.min(startA + lengthA, startB + lengthB) - Math.max(startA, startB));
}

// How much of a block's underside rests on the shelf or on the blocks directly under it, from 0 to 1
function supportFraction(block, others)
{
    if (block.y < EPS)
    {
        return 1;
    }

    let supported = 0;

    for (const other of others)
    {
        if (Math.abs(other.y + other.h - block.y) > EPS)
        {
            continue;
        }

        const across = overlapLength(block.x, block.w, other.x, other.w);
        const deep = overlapLength(block.z, block.d, other.z, other.d);

        if (across > EPS && deep > EPS)
        {
            supported += across * deep;
        }
    }

    return supported / (block.w * block.d);
}

function isStable(game)
{
    const others = gamesOnShelf(game.placement.shelfId).filter(function (other)
    {
        return other !== game;
    });

    return supportFraction(blockOf(game), others.map(blockOf)) >= MIN_SUPPORT - EPS;
}

function unshelve(game)
{
    game.placement = null;
    game.locked = false;
}

// Drops every box on the shelf until it rests on the shelf floor or on another box.
// Locked boxes fall too: the lock is against the auto-sorter, not against gravity.
function settleShelf(shelfId)
{
    const boxes = gamesOnShelf(shelfId).sort(function (a, b)
    {
        return a.placement.y - b.placement.y;
    });

    const settled = [];

    for (const box of boxes)
    {
        let y = 0;

        for (const below of settled)
        {
            if (overlapsFootprint(box, below))
            {
                y = Math.max(y, below.placement.y + below.height);
            }
        }

        box.placement.y = y;
        settled.push(box);
    }
}

// Moves anything that no longer fits the shelf to unsorted, then drops what was resting on it.
// Returns the number of boxes moved to unsorted.
function revalidateShelf(shelf)
{
    let evicted = 0;

    for (const game of gamesOnShelf(shelf.id))
    {
        if (!fitsShelf(game, shelf))
        {
            unshelve(game);
            evicted++;
        }
    }

    settleShelf(shelf.id);

    return evicted;
}

// ---------- Rendering ----------

function formatDims(item)
{
    return item.width + " × " + item.height + " × " + item.depth + " cm";
}

function hueFor(game)
{
    return hueForKey(game.name || "unnamed" + game.id);
}

function hueForKey(key)
{
    let hash = 0;

    for (let i = 0; i < key.length; i++)
    {
        hash = (hash * 31 + key.charCodeAt(i)) % 360;
    }

    return hash;
}

const labelMeasure = document.createElement("canvas").getContext("2d");

// Gives a label what CSS needs to shrink it to fit a face that is `along` cm in the reading direction and
// `across` cm the other way: those two sizes, and how wide the text is as a multiple of its font size.
// CSS does the sum so that the label keeps fitting as the zoom changes.
function setLabelFit(label, along, across)
{
    labelMeasure.font = "100px 'Segoe UI', system-ui, sans-serif";

    label.style.setProperty("--along", along);
    label.style.setProperty("--across", across);
    label.style.setProperty("--ems", Math.max(0.1, labelMeasure.measureText(label.textContent).width / 100));
}

// asLanding draws a game as a 3D solid even when it isn't shelved, for showing where a dragged box will land
function createBoxElement(game, asLanding)
{
    const el = document.createElement("div");
    el.className = "box";
    el.dataset.id = game.id;
    el.title = (game.name || "Unnamed") + "\n" + formatDims(game) +
        (game.locked ? "\nLocked in place" : "") +
        (game.rotationLocked ? "\nThis side up" : "") +
        "\nDouble-click to edit";
    el.style.setProperty("--w", game.width);
    el.style.setProperty("--h", game.height);
    el.style.setProperty("--hue", hueFor(game));

    if (game.height > game.width)
    {
        el.classList.add("tall");
    }

    if (!game.name)
    {
        el.classList.add("unnamed");
    }

    if (game.locked)
    {
        el.classList.add("locked");
    }

    // Allowed when placed by hand, but flagged
    if (game.placement && !isStable(game))
    {
        el.classList.add("unstable");
        el.title += "\nUnstable: less than half of it is supported";
    }

    if (game.placement && sticksOutTooFar(game, findShelf(game.placement.shelfId), game.placement.z))
    {
        el.classList.add("overhang");
        el.title += "\nSticks out further than this bookcase allows";
    }

    if (game.placement)
    {
        el.style.setProperty("--x", game.placement.x);
        el.style.setProperty("--y", game.placement.y);
    }

    const label = document.createElement("span");
    label.className = "box-name";
    label.textContent = game.name || "Unnamed";

    // A box standing in front of another goes see-through, in either view
    if (game.placement && blocksView(game))
    {
        el.classList.add("see-through");
    }

    // Tall boxes carry their label sideways, reading along the height
    const tall = game.height > game.width;
    setLabelFit(label, tall ? game.height : game.width, tall ? game.width : game.height);

    if (state.view3d && (game.placement || asLanding))
    {
        // Shelved boxes are drawn as solids in 3D: the element marks the back of the box and the label sits on its front face
        el.classList.add("solid");
        el.style.setProperty("--z", game.placement ? game.placement.z : 0);
        el.style.setProperty("--d", game.depth);

        for (const side of ["front", "top", "right"])
        {
            const sideEl = document.createElement("div");
            sideEl.className = "side side-" + side;
            el.appendChild(sideEl);
        }

        el.querySelector(".side-front").appendChild(label);

        // "This side up" boxes carry the delivery-box arrows on their right side
        if (game.rotationLocked)
        {
            const arrows = document.createElement("i");
            arrows.className = "arrows";
            arrows.textContent = "↑↑";
            el.querySelector(".side-right").appendChild(arrows);
        }
    }
    else
    {
        el.appendChild(label);
    }

    return el;
}

function createShelfElement(shelf, title, withTopButton)
{
    const shelfEl = document.createElement("div");
    shelfEl.className = "shelf";
    shelfEl.dataset.id = shelf.id;
    shelfEl.title = title + "\n" + formatDims(shelf) + (shelf.allowOverhang ? "" : "\nNo overhang");
    shelfEl.style.setProperty("--w", shelf.width);
    shelfEl.style.setProperty("--h", shelf.height);

    const label = document.createElement("span");
    label.className = "shelf-label";
    label.textContent = shelf.name || formatDims(shelf);
    shelfEl.appendChild(label);

    if (state.view3d)
    {
        shelfEl.style.setProperty("--d", shelf.depth);

        for (const part of ["shelf-floor", "shelf-wall", "shelf-floor-edge", "shelf-wall-edge", "shelf-top", "shelf-top-edge", "shelf-floor-end", "shelf-top-end"])
        {
            const partEl = document.createElement("div");
            partEl.className = part;
            shelfEl.appendChild(partEl);
        }
    }

    if (withTopButton)
    {
        const topButton = document.createElement("button");
        topButton.type = "button";
        topButton.className = "top-view-button";
        topButton.innerHTML =
            "<svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" +
            "<path d='M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z'/><circle cx='12' cy='12' r='3'/></svg>";
        topButton.title = "Open a top-down view of this shelf to arrange boxes front to back";
        topButton.setAttribute("aria-label", "Top view of this shelf");
        topButton.dataset.shelf = shelf.id;
        shelfEl.appendChild(topButton);
    }

    // Back to front, so that in the flat 2D view the nearer boxes are drawn over the ones behind them
    const boxes = gamesOnShelf(shelf.id).sort(function (a, b)
    {
        return a.placement.z + a.depth - b.placement.z - b.depth;
    });

    for (const game of boxes)
    {
        shelfEl.appendChild(createBoxElement(game));
    }

    return shelfEl;
}

function renderBookcases()
{
    const container = document.getElementById("bookcases");
    container.replaceChildren();

    state.bookcases.forEach(function (bookcase, bookcaseIndex)
    {
        const section = document.createElement("section");
        section.className = "bookcase";
        section.dataset.id = bookcase.id;

        const heading = document.createElement("h2");
        heading.textContent = bookcase.name || "Bookcase " + (bookcaseIndex + 1);
        heading.title = "Drag to reorder · double-click to edit";
        heading.draggable = true;
        section.appendChild(heading);

        const frame = document.createElement("div");
        frame.className = "bookcase-frame";

        for (let column = 0; column < bookcase.columns; column++)
        {
            const columnEl = document.createElement("div");
            columnEl.className = "bookcase-column";

            for (const shelf of columnShelves(bookcase, column))
            {
                columnEl.appendChild(createShelfElement(shelf, shelfLabel(shelf.id), true));
            }

            frame.appendChild(columnEl);
        }

        section.appendChild(frame);
        container.appendChild(section);
    });
}

// Alphabetical order for listing games: ignoring case, numbers in numeric order, unnamed games last
function compareByName(a, b)
{
    if (!a.name !== !b.name)
    {
        return a.name ? -1 : 1;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

function fillPiles(left, right)
{
    left.replaceChildren();
    right.replaceChildren();

    const unsorted = state.games.filter(function (game)
    {
        return !game.placement;
    }).sort(compareByName);

    // The first half goes in the left pile and the rest in the right, so the order reads on from one to the other
    const half = Math.ceil(unsorted.length / 2);

    unsorted.forEach(function (game, index)
    {
        const pile = index < half ? left : right;
        pile.appendChild(createBoxElement(game));
    });
}

function renderPiles()
{
    const left = document.getElementById("pileLeft");
    const right = document.getElementById("pileRight");

    fillPiles(left, right);
    document.getElementById("pileLeftCount").textContent = "(" + left.children.length + ")";
    document.getElementById("pileRightCount").textContent = "(" + right.children.length + ")";
}

function renderStatus()
{
    let shelved = 0;
    let locked = 0;
    let unstable = 0;
    let stickingOut = 0;
    let shelves = 0;

    for (const game of state.games)
    {
        if (game.placement)
        {
            shelved++;
        }

        if (game.locked)
        {
            locked++;
        }

        if (game.placement && !isStable(game))
        {
            unstable++;
        }

        if (game.placement && sticksOutTooFar(game, findShelf(game.placement.shelfId), game.placement.z))
        {
            stickingOut++;
        }
    }

    for (const bookcase of state.bookcases)
    {
        shelves += bookcase.shelves.length;
    }

    document.getElementById("status").textContent =
        state.games.length + " games · " + shelved + " shelved · " + locked + " locked · " + (unstable ? unstable + " unstable · " : "") +
        (stickingOut ? stickingOut + " sticking out too far · " : "") +
        state.bookcases.length + " bookcases · " + shelves + " shelves";
}

// Every change to the state ends in a render, so this is also where it gets saved
function renderViewMode()
{
    const root = document.documentElement.style;

    document.body.classList.toggle("view-3d", state.view3d);

    // The oblique projection, and the room (in cm) the sheared shelves need to the left of and below each bookcase
    root.setProperty("--frame-transform", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, " + -SHEAR + ", " + SHEAR + ", 1, 0, 0, 0, 0, 1)");
    root.setProperty("--pad", maxShelfDepth() * 1.5 * SHEAR);
    document.getElementById("btnView2d").setAttribute("aria-pressed", String(!state.view3d));
    document.getElementById("btnView3d").setAttribute("aria-pressed", String(state.view3d));
}

function render()
{
    renderViewMode();
    renderBookcases();
    renderPiles();
    renderStatus();

    if (!sorting)
    {
        saveState();
    }

    // Keep the top view dialog in step while it is open
    if (topViewShelfId !== null)
    {
        renderTopView();
    }
}

function showMessage(text)
{
    document.getElementById("message").textContent = text;

    // The status bar is hidden behind the top view dialog while that is open
    if (topViewShelfId !== null)
    {
        showTopViewMessage(text);
    }
}

// ---------- Zoom ----------

// Current pixels per cm, mirrored in the --px CSS variable
let scale = 4;

// Pixels per cm of whatever is being dragged in: the top view dialog draws its shelf at its own scale
function currentScale()
{
    return topViewShelfId !== null ? topViewScale : scale;
}

// Shelves a dragged box can land on: only the dialog's own shelf while the top view is open
function dragRoot()
{
    return document.getElementById(topViewShelfId !== null ? "dlgTopView" : "bookcases");
}

function setScale(pxPerCm)
{
    const zoom = document.getElementById("zoom");
    const clamped = Math.min(Number(zoom.max), Math.max(Number(zoom.min), pxPerCm));

    scale = clamped;
    document.documentElement.style.setProperty("--px", clamped + "px");
    zoom.value = clamped;
}

function fitScale()
{
    let tallest = 1;

    for (const bookcase of state.bookcases)
    {
        let total = 0;

        // Every column is the same height
        for (const shelf of columnShelves(bookcase, 0))
        {
            total += shelf.height;
        }

        tallest = Math.max(tallest, total);
    }

    if (state.view3d)
    {
        tallest += maxShelfDepth() * 1.5 * SHEAR;
    }

    // Leave room for the bookcase heading, frame boards and stage padding
    const available = document.getElementById("stage").clientHeight - 110;
    setScale(Math.floor((available / tallest) * 4) / 4);
}

// ---------- Dialogs ----------

// onClose receives "ok", "delete" or anything else for cancel
function openDialog(id, onClose)
{
    const dialog = document.getElementById(id);

    dialog.onclose = function ()
    {
        onClose(dialog.returnValue);
    };

    dialog.returnValue = "";
    dialog.showModal();
}

// ---------- Game editor 3D preview ----------

// Longest edge of the previewed box in px
const PREVIEW_SIZE = 120;

// id of the game being edited (or the id a new one will get), so an unnamed box previews in its real colour
let previewGameId = 0;

// Viewing angle in degrees, changed by dragging the preview
let previewTilt = -20;
let previewSpin = -30;

function gameFields()
{
    return document.querySelector("#dlgGame form").elements;
}

function updateGamePreview()
{
    const fields = gameFields();
    const cuboid = document.querySelector("#gamePreview .cuboid");
    const height = Math.max(0.1, Number(fields.height.value) || 0.1);
    const width = Math.max(0.1, Number(fields.width.value) || 0.1);
    const depth = Math.max(0.1, Number(fields.depth.value) || 0.1);
    const pxPerCm = PREVIEW_SIZE / Math.max(height, width, depth);
    const name = fields.name.value.trim();

    cuboid.style.setProperty("--cw", width * pxPerCm + "px");
    cuboid.style.setProperty("--ch", height * pxPerCm + "px");
    cuboid.style.setProperty("--cd", depth * pxPerCm + "px");
    cuboid.style.setProperty("--hue", hueForKey(name || "unnamed" + previewGameId));
    cuboid.style.setProperty("--tilt", previewTilt + "deg");
    cuboid.style.setProperty("--spin", previewSpin + "deg");
    cuboid.querySelector(".front span").textContent = name || "Front";

    // "This side up" shows delivery-box arrows and rules out the two tipping rotations
    const thisSideUp = fields.rotationLocked.checked;
    cuboid.classList.toggle("this-side-up", thisSideUp);

    for (const button of document.querySelectorAll("#dlgGame [data-swap*='height']"))
    {
        button.disabled = thisSideUp;
    }
}

// Turns the box a quarter turn by swapping two of its dimensions
function swapGameDims(a, b)
{
    const fields = gameFields();
    const kept = fields[a].value;

    fields[a].value = fields[b].value;
    fields[b].value = kept;
    updateGamePreview();
}

function initGamePreview()
{
    const preview = document.getElementById("gamePreview");
    let last = null;

    document.querySelector("#dlgGame form").addEventListener("input", updateGamePreview);

    for (const button of document.querySelectorAll("#dlgGame [data-swap]"))
    {
        button.addEventListener("click", function ()
        {
            const dims = button.dataset.swap.split(",");
            swapGameDims(dims[0], dims[1]);
        });
    }

    // Drag to look around the box
    preview.addEventListener("pointerdown", function (e)
    {
        last = { x: e.clientX, y: e.clientY };
        preview.setPointerCapture(e.pointerId);
    });

    preview.addEventListener("pointermove", function (e)
    {
        if (!last)
        {
            return;
        }

        previewSpin += (e.clientX - last.x) * 0.6;
        previewTilt = Math.min(90, Math.max(-90, previewTilt - (e.clientY - last.y) * 0.6));
        last = { x: e.clientX, y: e.clientY };
        updateGamePreview();
    });

    preview.addEventListener("pointerup", function ()
    {
        last = null;
    });

    preview.addEventListener("pointercancel", function ()
    {
        last = null;
    });
}

// ---------- Game editor ----------

// game is null when adding
function openGameDialog(game)
{
    const dialog = document.getElementById("dlgGame");
    const fields = dialog.querySelector("form").elements;

    dialog.querySelector("h3").textContent = game ? "Edit Game" : "Add Game";
    dialog.querySelector("[data-close='delete']").hidden = !game;
    dialog.querySelector("button[value='ok']").textContent = game ? "Save" : "Add";

    fields.name.value = game ? game.name : "";
    fields.width.value = game ? game.width : "";
    fields.height.value = game ? game.height : "";
    fields.depth.value = game ? game.depth : "";
    fields.rotationLocked.checked = game ? game.rotationLocked : false;
    fields.locked.checked = game ? game.locked : false;
    fields.locked.disabled = !game || !game.placement;

    previewGameId = game ? game.id : nextId;
    previewTilt = -20;
    previewSpin = -30;
    updateGamePreview();

    openDialog("dlgGame", function (result)
    {
        if (result === "ok")
        {
            saveGame(game, fields);
        }
        else if (result === "delete" && confirm("Delete " + (game.name || "this unnamed game") + "?"))
        {
            deleteGame(game);
        }
    });
}

function saveGame(game, fields)
{
    const adding = !game;

    if (adding)
    {
        game = makeGame("", 0, 0, 0);
        state.games.push(game);
    }

    game.name = fields.name.value.trim();
    game.width = Number(fields.width.value);
    game.height = Number(fields.height.value);
    game.depth = Number(fields.depth.value);
    game.rotationLocked = fields.rotationLocked.checked;

    const label = game.name || "Unnamed game";
    let message = adding ? "Added " + label : "Saved " + label;

    if (game.placement)
    {
        game.locked = fields.locked.checked;

        const shelf = findShelf(game.placement.shelfId);
        const collides = gamesOnShelf(shelf.id).some(function (other)
        {
            return other !== game && overlaps(game, other);
        });

        if (collides || !fitsShelf(game, shelf))
        {
            unshelve(game);
            message = label + " no longer fits where it was, so it moved to unsorted";
        }

        // Whether it left or just changed size, whatever was resting on it drops
        settleShelf(shelf.id);
    }

    render();
    showMessage(message);
}

function deleteGame(game)
{
    const shelfId = game.placement ? game.placement.shelfId : null;

    state.games.splice(state.games.indexOf(game), 1);

    if (shelfId !== null)
    {
        settleShelf(shelfId);
    }

    render();
    showMessage("Deleted " + (game.name || "unnamed game"));
}

// ---------- Bookcase editor ----------

// One row of the editor's shelf table. A row stands for a shelf in every column.
// rowIndex is which of the bookcase's existing rows it is, or null for a row being added.
function addShelfRow(values, rowIndex)
{
    const row = document.createElement("tr");
    row.dataset.row = rowIndex === null ? "" : rowIndex;
    row.innerHTML =
        "<td><input type='text' name='shelfName' placeholder='(optional name)'></td>" +
        "<td><input type='number' name='shelfHeight' min='0.1' step='0.1' required></td>" +
        "<td class='center'><input type='checkbox' name='shelfOverhang'></td>" +
        "<td><button type='button' class='row-remove' title='Remove shelf'>✕</button></td>";

    row.querySelector("[name='shelfName']").value = values.name;
    row.querySelector("[name='shelfHeight']").value = values.height;
    row.querySelector("[name='shelfOverhang']").checked = values.allowOverhang;

    document.getElementById("shelfRows").appendChild(row);
}

function readShelfRow(row)
{
    return {
        row: row.dataset.row === "" ? null : Number(row.dataset.row),
        name: row.querySelector("[name='shelfName']").value.trim(),
        height: Number(row.querySelector("[name='shelfHeight']").value),
        allowOverhang: row.querySelector("[name='shelfOverhang']").checked
    };
}

// bookcase is null when adding
function openBookcaseDialog(bookcase)
{
    const dialog = document.getElementById("dlgBookcase");
    const fields = dialog.querySelector("form").elements;

    dialog.querySelector("h3").textContent = bookcase ? "Edit Bookcase" : "Add Bookcase";
    dialog.querySelector("[data-close='delete']").hidden = !bookcase;
    dialog.querySelector("button[value='ok']").textContent = bookcase ? "Save" : "Add";

    // A new bookcase starts as a large IKEA BILLY
    fields.name.value = bookcase ? bookcase.name : "";
    fields.width.value = bookcase ? bookcase.shelves[0].width : BILLY_SHELF.width;
    fields.depth.value = bookcase ? bookcase.shelves[0].depth : BILLY_SHELF.depth;
    fields.columns.value = bookcase ? bookcase.columns : 1;
    fields.maxOverhang.value = bookcase ? bookcase.maxOverhang : DEFAULT_MAX_OVERHANG;
    document.getElementById("shelfRows").replaceChildren();

    if (bookcase)
    {
        columnShelves(bookcase, 0).forEach(addShelfRow);
    }
    else
    {
        for (let i = 0; i < BILLY_SHELF_COUNT; i++)
        {
            addShelfRow({ name: "", height: BILLY_SHELF.height, allowOverhang: true }, null);
        }
    }

    openDialog("dlgBookcase", function (result)
    {
        if (result === "ok")
        {
            saveBookcase(bookcase, fields);
        }
        else if (result === "delete" && confirm("Delete " + (bookcase.name || "this bookcase") + "? Its games move to unsorted."))
        {
            deleteBookcase(bookcase);
        }
    });
}

function saveBookcase(bookcase, fields)
{
    const adding = !bookcase;

    if (adding)
    {
        bookcase = { id: nextId++, name: "", columns: 1, shelves: [], maxOverhang: DEFAULT_MAX_OVERHANG };
        state.bookcases.push(bookcase);
    }

    const width = Number(fields.width.value);
    const depth = Number(fields.depth.value);
    const columns = Math.max(1, Math.round(Number(fields.columns.value)));
    const rows = Array.from(document.getElementById("shelfRows").rows).map(readShelfRow);
    const oldPerColumn = adding ? 0 : shelvesPerColumn(bookcase);
    const shelves = [];

    // A shelf that was already in this column and row is kept, so the games on it stay put
    for (let column = 0; column < columns; column++)
    {
        for (const values of rows)
        {
            const kept = values.row !== null && column < bookcase.columns;
            const shelf = kept ? bookcase.shelves[column * oldPerColumn + values.row] : makeShelf("", 0, 0, 0, true);

            shelf.name = values.name;
            shelf.width = width;
            shelf.height = values.height;
            shelf.depth = depth;
            shelf.allowOverhang = values.allowOverhang;
            shelves.push(shelf);
        }
    }

    let evicted = 0;

    // Games on shelves that were removed go back to unsorted
    for (const old of bookcase.shelves)
    {
        if (!shelves.includes(old))
        {
            for (const game of gamesOnShelf(old.id))
            {
                unshelve(game);
                evicted++;
            }
        }
    }

    bookcase.name = fields.name.value.trim();
    bookcase.maxOverhang = Number(fields.maxOverhang.value);
    bookcase.columns = columns;
    bookcase.shelves = shelves;

    for (const shelf of shelves)
    {
        evicted += revalidateShelf(shelf);
    }

    render();
    fitScale();
    showMessage((adding ? "Added " : "Saved ") + (bookcase.name || "bookcase") +
        (evicted ? " · " + evicted + " game(s) no longer fit and moved to unsorted" : ""));
}

function deleteBookcase(bookcase)
{
    for (const shelf of bookcase.shelves)
    {
        for (const game of gamesOnShelf(shelf.id))
        {
            unshelve(game);
        }
    }

    state.bookcases.splice(state.bookcases.indexOf(bookcase), 1);
    render();
    fitScale();
    showMessage("Deleted " + (bookcase.name || "bookcase"));
}

function initDialogs()
{
    initGamePreview();

    // Cancel/Delete are plain buttons so that Enter always submits via the Save button
    for (const button of document.querySelectorAll("dialog [data-close]"))
    {
        button.addEventListener("click", function ()
        {
            button.closest("dialog").close(button.dataset.close);
        });
    }

    document.getElementById("btnAddShelf").addEventListener("click", function ()
    {
        const rows = document.getElementById("shelfRows").rows;
        const copy = readShelfRow(rows[rows.length - 1]);
        copy.name = "";
        addShelfRow(copy, null);
    });

    document.getElementById("shelfRows").addEventListener("click", function (e)
    {
        const rows = document.getElementById("shelfRows").rows;

        // A bookcase keeps at least one shelf
        if (e.target.classList.contains("row-remove") && rows.length > 1)
        {
            e.target.closest("tr").remove();
        }
    });
}

// ---------- Bookcase reordering ----------

let draggedBookcaseId = null;

// Index in state.bookcases that a drop at this pointer position would insert before
function bookcaseDropIndex(clientX)
{
    const sections = document.querySelectorAll("#bookcases .bookcase");

    for (let i = 0; i < sections.length; i++)
    {
        const rect = sections[i].getBoundingClientRect();

        if (clientX < rect.left + rect.width / 2)
        {
            return i;
        }
    }

    return sections.length;
}

function clearDropMarkers()
{
    for (const el of document.querySelectorAll(".drop-before, .drop-after, .dragging"))
    {
        el.classList.remove("drop-before", "drop-after", "dragging");
    }
}

function initBookcaseDrag()
{
    const container = document.getElementById("bookcases");

    container.addEventListener("dragstart", function (e)
    {
        const section = e.target.closest(".bookcase");

        if (e.target.tagName !== "H2" || !section)
        {
            return;
        }

        draggedBookcaseId = Number(section.dataset.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", section.dataset.id);
        e.dataTransfer.setDragImage(section, section.offsetWidth / 2, 10);

        // Deferred so the drag image is captured before the original dims
        setTimeout(function ()
        {
            section.classList.add("dragging");
        }, 0);
    });

    container.addEventListener("dragover", function (e)
    {
        if (draggedBookcaseId === null)
        {
            return;
        }

        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        const sections = container.querySelectorAll(".bookcase");
        const index = bookcaseDropIndex(e.clientX);

        for (const el of sections)
        {
            el.classList.remove("drop-before", "drop-after");
        }

        if (index < sections.length)
        {
            sections[index].classList.add("drop-before");
        }
        else
        {
            sections[sections.length - 1].classList.add("drop-after");
        }
    });

    container.addEventListener("drop", function (e)
    {
        if (draggedBookcaseId === null)
        {
            return;
        }

        e.preventDefault();

        const bookcase = findBookcase(draggedBookcaseId);
        const from = state.bookcases.indexOf(bookcase);
        let to = bookcaseDropIndex(e.clientX);

        if (from < to)
        {
            to--;
        }

        state.bookcases.splice(from, 1);
        state.bookcases.splice(to, 0, bookcase);
        draggedBookcaseId = null;
        render();
    });

    container.addEventListener("dragend", function ()
    {
        draggedBookcaseId = null;
        clearDropMarkers();
    });
}

// ---------- Box dragging ----------

// Pointer travel in px before a press becomes a drag, so double-click still works
const DRAG_THRESHOLD = 4;

// A dragged box within this many cm of a wall or neighbour snaps flush against it
const SNAP_CM = 1.5;

let boxDrag = null;

// Moves value to the nearest snap point within SNAP_CM, ignoring points outside 0..max
function snapValue(value, points, max)
{
    let best = value;
    let nearest = SNAP_CM;

    for (const point of points)
    {
        if (point >= -EPS && point <= max + EPS && Math.abs(point - value) < nearest)
        {
            nearest = Math.abs(point - value);
            best = point;
        }
    }

    return best;
}

// Works out where a box released at x/y (cm from the shelf's bottom-left) would come to rest.
// Returns { x, y, valid, reason }.
function planDrop(game, shelf, x, y)
{
    const others = gamesOnShelf(shelf.id).filter(function (other)
    {
        return other !== game;
    });

    const maxX = Math.max(0, shelf.width - game.width);
    x = Math.min(maxX, Math.max(0, x));

    // Snap sideways to the shelf walls and to the sides of neighbouring boxes
    const snapPoints = [0, maxX];

    for (const other of others)
    {
        snapPoints.push(other.placement.x + other.width, other.placement.x - game.width);
    }

    x = snapValue(x, snapPoints, maxX);

    // Dragging here never changes depth (that is what the top view is for): a shelved box keeps how far forward
    // it sits, and a box coming from unsorted goes against the back wall
    const z = Math.min(game.placement ? game.placement.z : 0, maxDepthOffset(game, shelf));

    // Only boxes under its footprint can hold it up; ones wholly in front of or behind it are passed by
    const beneath = others.filter(function (other)
    {
        return x < other.placement.x + other.width - EPS && other.placement.x < x + game.width - EPS &&
            z < other.placement.z + other.depth - EPS && other.placement.z < z + game.depth - EPS;
    });

    // Fall from the release height onto whatever is below it
    const startY = Math.min(Math.max(0, shelf.height - game.height), Math.max(0, y));
    let restY = 0;
    let stackTop = 0;

    for (const other of beneath)
    {
        const top = other.placement.y + other.height;
        stackTop = Math.max(stackTop, top);

        if (top <= startY + EPS)
        {
            restY = Math.max(restY, top);
        }
    }

    const blocked = beneath.some(function (other)
    {
        return restY < other.placement.y + other.height - EPS && other.placement.y < restY + game.height - EPS;
    });

    // Released inside another box: sit on top of the whole stack instead
    if (blocked)
    {
        restY = stackTop;
    }

    const plan = { x: x, y: restY, z: z, valid: true, reason: "" };
    const label = game.name || "Unnamed game";

    plan.overhang = sticksOutTooFar(game, shelf, z);
    plan.unstable = supportFraction(
        { x: x, y: restY, z: z, w: game.width, h: game.height, d: game.depth },
        others.map(blockOf)) < MIN_SUPPORT - EPS;

    if (game.width > shelf.width + EPS)
    {
        plan.valid = false;
        plan.reason = label + " is wider than that shelf";
    }
    else if (!shelf.allowOverhang && game.depth > shelf.depth + EPS)
    {
        plan.valid = false;
        plan.reason = label + " is too deep for that shelf, which doesn't allow overhang";
    }
    else if (restY + game.height > shelf.height + EPS)
    {
        plan.valid = false;
        plan.reason = "Not enough height left for " + label + " there";
    }

    return plan;
}

function startBoxDrag()
{
    const ghost = boxDrag.sourceEl.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.classList.remove("see-through", "unstable", "overhang");
    ghost.style.setProperty("--px", currentScale() + "px");

    // A ghost left on the body would be drawn underneath the open top view dialog
    (topViewShelfId !== null ? document.getElementById("dlgTopView") : document.body).appendChild(ghost);

    // Where the box will land: 2D shows a dashed outline, 3D shows the whole box standing there
    let preview;

    if (state.view3d)
    {
        preview = createBoxElement(boxDrag.game, true);
        preview.classList.add("landing");
        preview.classList.remove("see-through", "locked", "unstable", "overhang");
        delete preview.dataset.id;
    }
    else
    {
        preview = document.createElement("div");
        preview.className = "drop-preview";
        preview.style.setProperty("--w", boxDrag.game.width);
        preview.style.setProperty("--h", boxDrag.game.height);
    }

    // The landing outline for the top-down plan, used while the top view is open
    const planPreview = document.createElement("div");
    planPreview.className = "top-box plan-preview";
    planPreview.style.setProperty("--w", boxDrag.game.width);
    planPreview.style.setProperty("--d", boxDrag.game.depth);

    boxDrag.ghost = ghost;
    boxDrag.preview = preview;
    boxDrag.planPreview = planPreview;
    boxDrag.active = true;
    boxDrag.sourceEl.classList.add("drag-source");
    document.body.classList.add("dragging-box");
}

// Handles a box being dragged over the top view's top-down plan: the pointer is the middle of its footprint.
// Returns false when the pointer is not over the plan.
function updatePlanHover(e)
{
    const game = boxDrag.game;
    const planEl = document.getElementById("topPlan");
    const rect = planEl.getBoundingClientRect();

    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
    {
        return false;
    }

    const shelf = findShelf(topViewShelfId);
    const label = game.name || "Unnamed game";
    const plan = planTopMove(
        game,
        shelf,
        (e.clientX - rect.left - planEl.clientLeft) / topViewScale - game.width / 2,
        (e.clientY - rect.top - planEl.clientTop) / topViewScale - game.depth / 2);

    plan.reason = plan.valid ? "" : "Not enough height left for " + label + " there";

    if (game.width > shelf.width + EPS)
    {
        plan.valid = false;
        plan.reason = label + " is wider than that shelf";
    }
    else if (!fitsDepth(game, shelf, plan.z))
    {
        plan.valid = false;
        plan.reason = label + " is too deep for that shelf, which doesn't allow overhang";
    }

    boxDrag.shelf = shelf;
    boxDrag.plan = plan;

    boxDrag.planPreview.style.setProperty("--x", plan.x);
    boxDrag.planPreview.style.setProperty("--z", plan.z);
    boxDrag.planPreview.classList.toggle("invalid", !plan.valid);
    boxDrag.planPreview.classList.toggle("unstable", plan.valid && plan.unstable);
    boxDrag.planPreview.classList.toggle("overhang", plan.valid && plan.overhang);
    planEl.appendChild(boxDrag.planPreview);

    // Show the same landing spot on the 3D shelf underneath
    boxDrag.preview.style.setProperty("--x", plan.x);
    boxDrag.preview.style.setProperty("--y", plan.y);
    boxDrag.preview.style.setProperty("--z", plan.z);
    boxDrag.preview.classList.toggle("invalid", !plan.valid);
    boxDrag.preview.classList.toggle("unstable", plan.valid && plan.unstable);
    boxDrag.preview.classList.toggle("overhang", plan.valid && plan.overhang);
    document.querySelector("#topShelf .shelf").appendChild(boxDrag.preview);
    boxDrag.ghost.style.visibility = "hidden";

    return true;
}

// While the top view is open, shows a drag on its 3D shelf in the top-down plan as well.
// plan is where the box would land, or null to put the plan back as it was.
function mirrorDragToPlan(plan)
{
    if (topViewShelfId === null)
    {
        return;
    }

    const game = boxDrag.game;
    const topEl = document.querySelector("#topPlan .top-box[data-id='" + game.id + "']");

    // A box coming from an unsorted pile isn't in the plan yet, so it gets the dashed landing outline there
    if (!topEl)
    {
        if (plan)
        {
            boxDrag.planPreview.style.setProperty("--x", plan.x);
            boxDrag.planPreview.style.setProperty("--z", plan.z);
            boxDrag.planPreview.classList.toggle("invalid", !plan.valid);
            boxDrag.planPreview.classList.toggle("unstable", plan.valid && plan.unstable);
            boxDrag.planPreview.classList.toggle("overhang", plan.valid && plan.overhang);
            document.getElementById("topPlan").appendChild(boxDrag.planPreview);
        }

        return;
    }

    const spot = plan || game.placement;

    // Just dropped onto an unsorted pile: the plan is about to be redrawn without it
    if (!spot)
    {
        return;
    }

    topEl.style.setProperty("--x", spot.x);
    topEl.style.setProperty("--z", spot.z);
    topEl.classList.toggle("moving", Boolean(plan));
    topEl.classList.toggle("invalid", Boolean(plan) && !plan.valid);
    topEl.classList.toggle("unstable", plan ? plan.valid && plan.unstable : !isStable(game));
    topEl.classList.toggle("overhang", plan ? plan.valid && plan.overhang : sticksOutTooFar(game, findShelf(spot.shelfId), spot.z));
}

function updateBoxDrag(e)
{
    const game = boxDrag.game;
    const left = e.clientX - boxDrag.offsetX;
    const top = e.clientY - boxDrag.offsetY;
    const pxPerCm = currentScale();
    const width = game.width * pxPerCm;
    const height = game.height * pxPerCm;

    boxDrag.ghost.style.left = left + "px";
    boxDrag.ghost.style.top = top + "px";
    boxDrag.clientX = e.clientX;
    boxDrag.clientY = e.clientY;
    boxDrag.shelf = null;
    boxDrag.plan = null;
    boxDrag.ghost.style.visibility = "";
    mirrorDragToPlan(null);

    // In 3D the ghost stands for the box's front face, which is drawn sheared down and left of the back wall
    // that shelf positions are measured from
    const frontZ = (game.placement ? game.placement.z : 0) + game.depth;
    const shift = state.view3d ? frontZ * pxPerCm * SHEAR : 0;

    // The target shelf is whichever one the middle of the dragged box is over
    const centreX = left + shift + width / 2;
    const centreY = top - shift + height / 2;

    // Over the top-down plan the pointer picks the spot seen from above instead
    if (topViewShelfId !== null && updatePlanHover(e))
    {
        return;
    }

    boxDrag.planPreview.remove();

    for (const shelfEl of dragRoot().querySelectorAll(".shelf"))
    {
        const rect = shelfEl.getBoundingClientRect();

        if (centreX >= rect.left && centreX <= rect.right && centreY >= rect.top && centreY <= rect.bottom)
        {
            const shelf = findShelf(Number(shelfEl.dataset.id));
            const x = (left + shift - rect.left - shelfEl.clientLeft) / pxPerCm;
            const y = (rect.bottom - top + shift - height) / pxPerCm;
            const plan = planDrop(game, shelf, x, y);

            boxDrag.shelf = shelf;
            boxDrag.plan = plan;
            boxDrag.preview.style.setProperty("--x", plan.x);
            boxDrag.preview.style.setProperty("--y", plan.y);
            boxDrag.preview.style.setProperty("--z", plan.z);
            boxDrag.preview.classList.toggle("invalid", !plan.valid);
            boxDrag.preview.classList.toggle("unstable", plan.valid && plan.unstable);
            boxDrag.preview.classList.toggle("overhang", plan.valid && plan.overhang);
            shelfEl.appendChild(boxDrag.preview);
            mirrorDragToPlan(plan);

            // In 3D the landing box itself is what moves, so the flat ghost only shows away from the shelves
            if (state.view3d)
            {
                boxDrag.ghost.style.visibility = "hidden";
            }

            return;
        }
    }

    boxDrag.preview.remove();
}

function endBoxDrag()
{
    if (boxDrag.active)
    {
        mirrorDragToPlan(null);
        boxDrag.ghost.remove();
        boxDrag.preview.remove();
        boxDrag.planPreview.remove();
        boxDrag.sourceEl.classList.remove("drag-source");
        document.body.classList.remove("dragging-box");
    }

    boxDrag = null;
}

function dropBox()
{
    const game = boxDrag.game;
    const shelf = boxDrag.shelf;
    const plan = boxDrag.plan;
    const label = game.name || "Unnamed game";
    const oldShelfId = game.placement ? game.placement.shelfId : null;
    const overPile = document.elementFromPoint(boxDrag.clientX, boxDrag.clientY);

    if (shelf && plan.valid)
    {
        game.placement = { shelfId: shelf.id, x: plan.x, y: plan.y, z: plan.z };
        showMessage("Shelved " + label +
            (plan.unstable ? " · unstable: less than half of it is supported" : "") +
            (plan.overhang ? " · sticks out further than this bookcase allows" : ""));
    }
    else if (shelf)
    {
        showMessage(plan.reason);
    }
    else if (game.placement && overPile && overPile.closest(".pile-panel"))
    {
        unshelve(game);
        showMessage(label + " moved to unsorted");
    }

    endBoxDrag();

    // Whatever was resting on the box where it used to be drops down
    if (oldShelfId !== null)
    {
        settleShelf(oldShelfId);
    }

    if (game.placement)
    {
        settleShelf(game.placement.shelfId);
    }

    render();

    if (topViewShelfId !== null)
    {
        renderTopView();
    }
}

function initBoxDrag()
{
    const pressBox = function (e)
    {
        const el = e.target.closest(".box");

        if (e.button !== 0 || !el)
        {
            return;
        }

        // A 3D box is grabbed by its front face
        const rect = (el.querySelector(".side-front") || el).getBoundingClientRect();

        boxDrag =
        {
            game: findGame(Number(el.dataset.id)),
            sourceEl: el,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            startX: e.clientX,
            startY: e.clientY,
            active: false
        };
    };

    document.querySelector(".workspace").addEventListener("pointerdown", pressBox);
    document.getElementById("dlgTopView").addEventListener("pointerdown", pressBox);

    window.addEventListener("pointermove", function (e)
    {
        if (!boxDrag)
        {
            return;
        }

        if (!boxDrag.active)
        {
            if (Math.hypot(e.clientX - boxDrag.startX, e.clientY - boxDrag.startY) < DRAG_THRESHOLD)
            {
                return;
            }

            if (boxDrag.game.locked)
            {
                showMessage((boxDrag.game.name || "Unnamed game") + " is locked in place · double-click it to unlock");
                boxDrag = null;
                return;
            }

            startBoxDrag();
        }

        updateBoxDrag(e);
    });

    window.addEventListener("pointerup", function ()
    {
        if (!boxDrag)
        {
            return;
        }

        if (boxDrag.active)
        {
            dropBox();
        }
        else
        {
            boxDrag = null;
        }
    });

    window.addEventListener("pointercancel", function ()
    {
        if (boxDrag)
        {
            endBoxDrag();
        }
    });

    window.addEventListener("keydown", function (e)
    {
        if (e.key === "Escape" && boxDrag)
        {
            endBoxDrag();
        }
    });
}

// ---------- 2D / 3D view ----------

// Only the drawing changes: the layout is the same either way
function setViewMode(view3d)
{
    if (view3d === state.view3d)
    {
        return;
    }

    state.view3d = view3d;
    render();
    fitScale();
}

// ---------- Top view ----------

// The zoom the user has chosen for the top view, in px per cm, or null to fit the shelf to the window
let topViewZoom = null;

let topViewShelfId = null;
let topViewScale = 1;
let topDrag = null;

function shelfTitle(shelfId)
{
    const where = locateShelf(shelfId);

    return (where.bookcase.name || "Bookcase " + (where.bookcaseIndex + 1)) + " · " + shelfLabel(shelfId);
}

function showTopViewMessage(text)
{
    document.getElementById("topViewMessage").textContent = text;
}

function renderTopView()
{
    const shelf = findShelf(topViewShelfId);
    const planEl = document.getElementById("topPlan");

    // Lowest first, so the boxes on top of a stack are drawn (and grabbed) last
    const boxes = gamesOnShelf(shelf.id).sort(function (a, b)
    {
        return a.placement.y - b.placement.y;
    });

    // Shelves that allow overhang get extra room drawn in front of the shelf edge
    let drawnDepth = shelf.depth;

    if (shelf.allowOverhang)
    {
        drawnDepth = Math.max(shelf.depth * 1.5, shelf.depth + bookcaseOfShelf(shelf.id).maxOverhang + 4);

        for (const game of boxes)
        {
            drawnDepth = Math.max(drawnDepth, game.placement.z + game.depth);
        }
    }

    const zoom = document.getElementById("topZoom");

    if (topViewZoom === null)
    {
        // Fit: the plan and the front view of the shelf, one above the other, have to fit the window along with the
        // dialog's own text and buttons, and the unsorted piles either side. 3D needs room for the sheared depth.
        const sheared = state.view3d ? maxShelfDepth() * 1.5 * SHEAR : 0;
        const acrossFit = (window.innerWidth - 560) / (shelf.width + sheared);
        const downFit = (window.innerHeight - 330) / (drawnDepth + shelf.height + sheared);

        topViewScale = Math.min(Number(zoom.max), Math.max(Number(zoom.min), Math.floor(Math.min(acrossFit, downFit) * 4) / 4));
    }
    else
    {
        topViewScale = topViewZoom;
    }

    zoom.value = topViewScale;

    document.querySelector("#dlgTopView h3").textContent = "Top view · " + shelfTitle(shelf.id);
    planEl.replaceChildren();

    // The back wall and the two side walls, which stop at the shelf's front edge
    for (const wall of ["back", "left", "right"])
    {
        const wallEl = document.createElement("div");
        wallEl.className = "plan-wall plan-wall-" + wall;
        planEl.appendChild(wallEl);
    }
    planEl.classList.toggle("overhang", shelf.allowOverhang);
    planEl.style.setProperty("--px", topViewScale + "px");
    planEl.style.setProperty("--w", shelf.width);
    planEl.style.setProperty("--d", shelf.depth);
    planEl.style.setProperty("--drawn", drawnDepth);
    planEl.style.setProperty("--limit", bookcaseOfShelf(shelf.id).maxOverhang);

    for (const game of boxes)
    {
        const el = document.createElement("div");
        el.className = "top-box";
        el.dataset.id = game.id;
        el.title = (game.name || "Unnamed") + "\n" + formatDims(game) +
            (game.placement.y > EPS ? "\nStacked " + game.placement.y + " cm up" : "") +
            (game.locked ? "\nLocked in place" : "");
        el.style.setProperty("--x", game.placement.x);
        el.style.setProperty("--z", game.placement.z);
        el.style.setProperty("--w", game.width);
        el.style.setProperty("--d", game.depth);
        el.style.setProperty("--hue", hueFor(game));
        el.classList.toggle("raised", game.placement.y > EPS);
        el.classList.toggle("locked", game.locked);
        el.classList.toggle("unstable", !isStable(game));
        el.classList.toggle("overhang", sticksOutTooFar(game, shelf, game.placement.z));

        const label = document.createElement("span");
        label.className = "box-name";
        label.textContent = game.name || "Unnamed";

        // From above, a box deeper than it is wide carries its label sideways
        const tall = game.depth > game.width;
        el.classList.toggle("tall", tall);
        setLabelFit(label, tall ? game.depth : game.width, tall ? game.width : game.depth);
        el.appendChild(label);

        planEl.appendChild(el);
    }

    // The same shelf from the front underneath (in whichever view is showing), drawn at the same scale
    const frame = document.createElement("div");
    frame.className = "bookcase-frame";
    frame.style.setProperty("--px", topViewScale + "px");
    frame.appendChild(createShelfElement(shelf, shelfLabel(shelf.id), false));
    document.getElementById("topShelf").replaceChildren(frame);

    // Unsorted games to either side, at the same scale
    const pileLeft = document.getElementById("topPileLeft");
    const pileRight = document.getElementById("topPileRight");

    pileLeft.style.setProperty("--px", topViewScale + "px");
    pileRight.style.setProperty("--px", topViewScale + "px");
    fillPiles(pileLeft, pileRight);
}

function openTopView(shelfId)
{
    topViewShelfId = shelfId;
    topViewZoom = null;
    showTopViewMessage("");
    renderTopView();

    openDialog("dlgTopView", function ()
    {
        topViewShelfId = null;
        topDrag = null;
    });
}

// Where a box slid to x/z on its shelf would end up: snapped to walls and neighbours, resting on whatever is under it.
// Returns { x, y, z, valid }.
function planTopMove(game, shelf, x, z)
{
    const others = gamesOnShelf(shelf.id).filter(function (other)
    {
        return other !== game;
    });

    const maxX = Math.max(0, shelf.width - game.width);
    const maxZ = maxDepthOffset(game, shelf);
    const xPoints = [0, maxX];
    const zPoints = [0, maxZ, shelf.depth - game.depth];

    for (const other of others)
    {
        xPoints.push(other.placement.x + other.width, other.placement.x - game.width);
        zPoints.push(other.placement.z + other.depth, other.placement.z - game.depth);
    }

    x = snapValue(Math.min(maxX, Math.max(0, x)), xPoints, maxX);
    z = snapValue(Math.min(maxZ, Math.max(0, z)), zPoints, maxZ);

    let y = 0;

    for (const other of others)
    {
        const across = x < other.placement.x + other.width - EPS && other.placement.x < x + game.width - EPS;
        const deep = z < other.placement.z + other.depth - EPS && other.placement.z < z + game.depth - EPS;

        if (across && deep)
        {
            y = Math.max(y, other.placement.y + other.height);
        }
    }

    const unstable = supportFraction(
        { x: x, y: y, z: z, w: game.width, h: game.height, d: game.depth },
        others.map(blockOf)) < MIN_SUPPORT - EPS;

    return {
        x: x, y: y, z: z, valid: y + game.height <= shelf.height + EPS,
        unstable: unstable, overhang: sticksOutTooFar(game, shelf, z)
    };
}

function initTopView()
{
    const planEl = document.getElementById("topPlan");

    document.getElementById("topZoom").addEventListener("input", function (e)
    {
        topViewZoom = Number(e.target.value);
        renderTopView();
    });

    document.getElementById("btnTopFit").addEventListener("click", function ()
    {
        topViewZoom = null;
        renderTopView();
    });

    // Double-click a box in either half to edit it
    document.getElementById("dlgTopView").addEventListener("dblclick", function (e)
    {
        const el = e.target.closest(".top-box, .box");

        if (el)
        {
            openGameDialog(findGame(Number(el.dataset.id)));
        }
    });

    planEl.addEventListener("pointerdown", function (e)
    {
        const el = e.target.closest(".top-box");

        if (e.button !== 0 || !el)
        {
            return;
        }

        const game = findGame(Number(el.dataset.id));

        if (game.locked)
        {
            showTopViewMessage((game.name || "Unnamed game") + " is locked in place");
            return;
        }

        topDrag = { game: game, el: el, startX: e.clientX, startY: e.clientY, originX: game.placement.x, originZ: game.placement.z, plan: null, active: false };
    });

    planEl.addEventListener("pointermove", function (e)
    {
        if (!topDrag)
        {
            return;
        }

        if (!topDrag.active)
        {
            // The button was let go somewhere outside the plan
            if (e.buttons === 0)
            {
                topDrag = null;
                return;
            }

            if (Math.hypot(e.clientX - topDrag.startX, e.clientY - topDrag.startY) < DRAG_THRESHOLD)
            {
                return;
            }

            // Only a real drag captures the pointer: capturing on press would swallow double-clicks
            topDrag.active = true;
            topDrag.el.classList.add("moving");
            planEl.setPointerCapture(e.pointerId);
        }

        // Carried out over one of the unsorted piles: letting go there takes it off the shelf
        const under = document.elementFromPoint(e.clientX, e.clientY);

        topDrag.overPile = Boolean(under && under.closest("#dlgTopView .pile-panel"));
        topDrag.el.classList.toggle("leaving", topDrag.overPile);

        if (topDrag.overPile)
        {
            showTopViewMessage("Let go to move it to unsorted");
            return;
        }

        const plan = planTopMove(
            topDrag.game,
            findShelf(topViewShelfId),
            topDrag.originX + (e.clientX - topDrag.startX) / topViewScale,
            topDrag.originZ + (e.clientY - topDrag.startY) / topViewScale);

        topDrag.plan = plan;
        topDrag.el.style.setProperty("--x", plan.x);
        topDrag.el.style.setProperty("--z", plan.z);
        topDrag.el.classList.toggle("invalid", !plan.valid);
        topDrag.el.classList.toggle("unstable", plan.valid && plan.unstable);
        topDrag.el.classList.toggle("overhang", plan.valid && plan.overhang);

        // Mirror the move in the 3D view underneath as it happens
        const solid = document.querySelector("#topShelf .box[data-id='" + topDrag.game.id + "']");

        if (solid)
        {
            solid.style.setProperty("--x", plan.x);
            solid.style.setProperty("--y", plan.y);
            solid.style.setProperty("--z", plan.z);
            solid.classList.toggle("unstable", plan.unstable);
            solid.classList.toggle("overhang", plan.overhang);
        }

        if (!plan.valid)
        {
            showTopViewMessage("Not enough height to stack it there");
        }
        else
        {
            const warnings = [];

            if (plan.unstable)
            {
                warnings.push("Unstable there: less than half of it would be supported");
            }

            if (plan.overhang)
            {
                warnings.push("Sticks out further than this bookcase allows");
            }

            showTopViewMessage(warnings.join(" · ") || (plan.y > EPS ? "It will sit on top of the box underneath" : ""));
        }
    });

    planEl.addEventListener("pointerup", function ()
    {
        if (!topDrag)
        {
            return;
        }

        const game = topDrag.game;
        const plan = topDrag.plan;
        const overPile = topDrag.overPile;
        topDrag = null;

        if (overPile)
        {
            unshelve(game);

            // Anything that was resting on it drops
            settleShelf(topViewShelfId);
            render();
            showTopViewMessage((game.name || "Unnamed game") + " moved to unsorted");
            return;
        }

        // A click without a drag changes nothing
        if (!plan)
        {
            return;
        }

        if (plan && plan.valid)
        {
            game.placement.x = plan.x;
            game.placement.y = plan.y;
            game.placement.z = plan.z;

            // Anything that was resting on it drops
            settleShelf(topViewShelfId);
            render();
            showTopViewMessage("");
        }

        renderTopView();
    });

    planEl.addEventListener("pointercancel", function ()
    {
        topDrag = null;
        renderTopView();
    });
}

// ---------- Unshelve ----------

function unshelveUnlocked()
{
    const movable = state.games.filter(function (game)
    {
        return game.placement && !game.locked;
    });

    const count = movable.length;

    if (count === 0)
    {
        showMessage("Nothing to unshelve");
        return;
    }

    if (!confirm("Move " + count + " unlocked game(s) off the shelves and back to unsorted? Locked games stay where they are."))
    {
        return;
    }

    for (const game of movable)
    {
        unshelve(game);
    }

    for (const bookcase of state.bookcases)
    {
        for (const shelf of bookcase.shelves)
        {
            settleShelf(shelf.id);
        }
    }

    render();
    showMessage("Moved " + count + " game(s) to unsorted");
}

// ---------- Auto-sort ----------

// Every way up a game may be stored: all six, or only the two that keep its height when it is "this side up".
// Returned as { w, h, d } sizes with duplicates (from equal sides) removed.
function orientationsOf(game)
{
    const w = game.width;
    const h = game.height;
    const d = game.depth;

    // Each is [width, height, depth]
    const all = game.rotationLocked
        ? [[w, h, d], [d, h, w]]
        : [[w, h, d], [d, h, w], [h, w, d], [d, w, h], [h, d, w], [w, d, h]];
    const seen = new Set();
    const result = [];

    for (const o of all)
    {
        const key = o.join("x");

        if (!seen.has(key))
        {
            seen.add(key);
            result.push({ w: o[0], h: o[1], d: o[2] });
        }
    }

    return result;
}

// Scores are lists of numbers compared left to right; lower is better
function compareScores(a, b)
{
    for (let i = 0; i < a.length; i++)
    {
        if (Math.abs(a[i] - b[i]) > EPS)
        {
            return a[i] - b[i];
        }
    }

    return 0;
}

// How much of a box's front has to show past the boxes standing in front of it for it to count as visible
const MIN_VISIBLE_SHARE = 0.5;

// The share of a block's front, from 0 to 1, that can be seen from the front of the shelf
function visibleShare(block, blocks)
{
    const inFront = blocks.filter(function (other)
    {
        return other !== block && other.z >= block.z + block.d - EPS &&
            overlapLength(block.x, block.w, other.x, other.w) > EPS && overlapLength(block.y, block.h, other.y, other.h) > EPS;
    });

    if (inFront.length === 0)
    {
        return 1;
    }

    // Cut the block's front into a grid along every edge of the blocks in front, and add up the uncovered cells
    const edges = function (start, length, pick)
    {
        const values = [start, start + length];

        for (const other of inFront)
        {
            for (const value of pick(other))
            {
                if (value > start + EPS && value < start + length - EPS)
                {
                    values.push(value);
                }
            }
        }

        return values.sort(function (a, b)
        {
            return a - b;
        });
    };

    const xs = edges(block.x, block.w, function (other)
    {
        return [other.x, other.x + other.w];
    });

    const ys = edges(block.y, block.h, function (other)
    {
        return [other.y, other.y + other.h];
    });

    let showing = 0;

    for (let i = 0; i < xs.length - 1; i++)
    {
        for (let j = 0; j < ys.length - 1; j++)
        {
            const midX = (xs[i] + xs[i + 1]) / 2;
            const midY = (ys[j] + ys[j + 1]) / 2;
            const covered = inFront.some(function (other)
            {
                return midX > other.x && midX < other.x + other.w && midY > other.y && midY < other.y + other.h;
            });

            if (!covered)
            {
                showing += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
            }
        }
    }

    return showing / (block.w * block.h);
}

function isVisible(block, blocks)
{
    return visibleShare(block, blocks) >= MIN_VISIBLE_SHARE - EPS;
}

// A summary of the headroom left on a shelf, used to rule out boxes that cannot possibly fit without searching it.
// For each height that boxes on the shelf reach, it holds the widest unbroken stretch of shelf where nothing
// stands taller than that. A stretch only counts as occupied to the height of its lowest point front to back,
// since a box might still go in behind or in front of what is there.
// Returned as [height, widest stretch] pairs with heights ascending.
function shelfRoom(bin)
{
    const blocks = bin.blocks;
    const ascending = function (a, b)
    {
        return a - b;
    };

    const xs = [0, bin.shelf.width];
    const zs = [0, bin.shelf.depth];

    for (const b of blocks)
    {
        xs.push(Math.min(bin.shelf.width, b.x), Math.min(bin.shelf.width, b.x + b.w));
        zs.push(Math.min(bin.shelf.depth, b.z), Math.min(bin.shelf.depth, b.z + b.d));
    }

    xs.sort(ascending);
    zs.sort(ascending);

    // How high the boxes reach over each stretch of shelf between two neighbouring box edges
    const stretches = [];

    for (let i = 0; i < xs.length - 1; i++)
    {
        if (xs[i + 1] - xs[i] < EPS)
        {
            continue;
        }

        const midX = (xs[i] + xs[i + 1]) / 2;
        let reach = Infinity;

        for (let k = 0; k < zs.length - 1; k++)
        {
            if (zs[k + 1] - zs[k] < EPS)
            {
                continue;
            }

            const midZ = (zs[k] + zs[k + 1]) / 2;
            let top = 0;

            for (const b of blocks)
            {
                if (midX > b.x && midX < b.x + b.w && midZ > b.z && midZ < b.z + b.d)
                {
                    top = Math.max(top, b.y + b.h);
                }
            }

            reach = Math.min(reach, top);
        }

        stretches.push({ width: xs[i + 1] - xs[i], reach: reach });
    }

    const heights = stretches.map(function (stretch)
    {
        return stretch.reach;
    }).sort(ascending);

    const room = [];

    for (let h = 0; h < heights.length; h++)
    {
        if (h > 0 && heights[h] - heights[h - 1] < EPS)
        {
            continue;
        }

        let widest = 0;
        let run = 0;

        for (const stretch of stretches)
        {
            run = stretch.reach <= heights[h] + EPS ? run + stretch.width : 0;
            widest = Math.max(widest, run);
        }

        room.push([heights[h], widest]);
    }

    return room;
}

// False when a box w wide and h tall cannot fit anywhere on the shelf, whatever its depth. True means "maybe".
function mightFit(bin, w, h)
{
    if (!bin.room)
    {
        bin.room = shelfRoom(bin);
    }

    let widest = 0;

    for (const entry of bin.room)
    {
        if (entry[0] > bin.shelf.height - h + EPS)
        {
            break;
        }

        widest = entry[1];
    }

    return widest >= w - EPS;
}

// The best resting place on one shelf for a box of size o, or null if it can't go there.
// bin is { shelf, blocks } where blocks are what is already on the shelf.
//
// Candidate spots are the left wall and flush against either side of each box already there, and also lined up
// with, or directly in front of, each of those boxes. The box drops onto whatever is under it, and a spot only
// counts if the box then fits under the shelf above, is at least half supported, has at least half its depth on
// the shelf, and leaves at least half of every box's front (its own included) visible from the front.
// The back row is always preferred to standing in front of something.
//
// scoring "narrow" favours spots that use the least new shelf width (boxes end up on edge, like books);
// "low" favours the lowest finished height (boxes end up lying in stacks).
function bestSpot(bin, o, scoring)
{
    const shelf = bin.shelf;

    if (o.w > shelf.width + EPS || o.h > shelf.height + EPS || !mightFit(bin, o.w, o.h))
    {
        return null;
    }

    const blocks = bin.blocks;
    const maxX = shelf.width - o.w;
    const volume = o.w * o.h * o.d;
    const ascending = function (a, b)
    {
        return a - b;
    };

    const xs = [0];
    let usedWidth = 0;

    for (const b of blocks)
    {
        xs.push(b.x, b.x + b.w, b.x + b.w - o.w);
        usedWidth = Math.max(usedWidth, b.x + b.w);
    }

    // Stacked boxes share their edges, so most candidates are repeats: sorted, they can be skipped as they come up
    xs.sort(ascending);

    let best = null;
    let lastX = -Infinity;

    for (const x of xs)
    {
        if (x < -EPS || x > maxX + EPS || x - lastX < EPS)
        {
            continue;
        }

        lastX = x;

        // Only boxes in this stretch of shelf can be under, behind or in front of the new one
        const column = [];
        const zs = [0];

        for (const b of blocks)
        {
            if (b.x < x + o.w - EPS && x < b.x + b.w - EPS)
            {
                column.push(b);
                zs.push(b.z, b.z + b.d);
            }
        }

        zs.sort(ascending);

        let lastZ = -Infinity;

        for (const z of zs)
        {
            if (z - lastZ < EPS)
            {
                continue;
            }

            lastZ = z;

            // Front to back: nothing sticks out of a shelf that forbids it; elsewhere at least half the box stays
            // on the shelf and it sticks out no further than the bookcase allows
            const overhang = Math.max(0, z + o.d - shelf.depth);

            if (shelf.allowOverhang ? (z + o.d / 2 > shelf.depth + EPS || overhang > bin.maxOverhang + EPS) : overhang > EPS)
            {
                continue;
            }

            let y = 0;

            for (const b of column)
            {
                if (b.z < z + o.d - EPS && z < b.z + b.d - EPS)
                {
                    y = Math.max(y, b.y + b.h);
                }
            }

            if (y + o.h > shelf.height + EPS)
            {
                continue;
            }

            // A box in front of others has to be pushed back against one of them, not left standing in mid-shelf,
            // and may not be bigger than any box it stands directly in front of: smaller games go at the front
            if (z > EPS)
            {
                let pushedBack = false;
                let biggerThanBehind = false;

                for (const b of column)
                {
                    if (Math.abs(b.z + b.d - z) < EPS && b.y < y + o.h - EPS && y < b.y + b.h - EPS)
                    {
                        pushedBack = true;

                        if (volume > b.w * b.h * b.d + EPS)
                        {
                            biggerThanBehind = true;
                        }
                    }
                }

                if (!pushedBack || biggerThanBehind)
                {
                    continue;
                }
            }

            const block = { x: x, y: y, z: z, w: o.w, h: o.h, d: o.d };
            const support = supportFraction(block, column);

            if (support < MIN_SUPPORT - EPS)
            {
                continue;
            }

            // At least half of every game's front has to stay visible: this box past whatever stands in front
            // of it, and each box behind it past this one. (A box that was already hidden when the sort began,
            // by boxes that are staying put, is left as it was.)
            if (!isVisible(block, column))
            {
                continue;
            }

            if (z > EPS)
            {
                const withBlock = blocks.concat([block]);
                const hidesOne = column.some(function (b)
                {
                    return b.z + b.d <= z + EPS && isVisible(b, blocks) && !isVisible(b, withBlock);
                });

                if (hidesOne)
                {
                    continue;
                }
            }

            // Resting entirely on the shelf or on boxes at least as big beats hanging over the edge of what is below:
            // it keeps bigger boxes at the bottom of each stack and leaves no pockets of dead space underneath
            const loose = support < 1 - 1e-3 ? 1 : 0;
            const inFront = z > EPS ? 1 : 0;
            const newWidth = Math.max(0, x + o.w - usedWidth);
            const score = scoring === "narrow"
                ? [inFront, loose, newWidth, y, x, z, overhang]
                : [inFront, loose, y + o.h, newWidth, x, z, overhang];

            if (!best || compareScores(score, best.score) < 0)
            {
                best = { block: block, score: score };
            }
        }
    }

    return best;
}

// Places the games one at a time, each on the first shelf that can take it, in whichever orientation scores best there.
// Returns { placed: [{ game, shelf, block }], unplaced, shelvesUsed }.
function packGames(games, bins, scoring)
{
    const placed = [];
    let unplaced = 0;

    for (const game of games)
    {
        let chosen = null;
        const orientations = orientationsOf(game);

        for (const bin of bins)
        {
            for (const o of orientations)
            {
                const spot = bestSpot(bin, o, scoring);

                if (spot && (!chosen || compareScores(spot.score, chosen.spot.score) < 0))
                {
                    chosen = { bin: bin, spot: spot };
                }
            }

            if (chosen)
            {
                break;
            }
        }

        if (chosen)
        {
            chosen.bin.room = null;
            chosen.bin.blocks.push(chosen.spot.block);
            placed.push({ game: game, shelf: chosen.bin.shelf, block: chosen.spot.block });
        }
        else
        {
            unplaced++;
        }
    }

    const shelvesUsed = bins.filter(function (bin)
    {
        return bin.blocks.length > 0;
    }).length;

    return { placed: placed, unplaced: unplaced, shelvesUsed: shelvesUsed, bins: bins };
}

// The shelves in the order the sorter fills them: ones that already hold games that are staying put first (they
// are in use anyway), then bookcases left to right, column by column, each column from the bottom shelf up so the
// biggest games end up lowest.
// movable is the set of games being sorted; every other shelved game is a fixed obstacle. Left out, it is every
// unlocked game. (During a live sort the layout being shown is on the shelves too, so the movable games must
// not be counted as obstacles.)
function makeSortBins(movable)
{
    const bins = [];

    const staysPut = function (game)
    {
        return movable ? !movable.has(game) : game.locked;
    };

    for (const bookcase of state.bookcases)
    {
        for (let column = 0; column < bookcase.columns; column++)
        {
            for (const shelf of columnShelves(bookcase, column).reverse())
            {
                bins.push({ shelf: shelf, maxOverhang: bookcase.maxOverhang, blocks: gamesOnShelf(shelf.id).filter(staysPut).map(blockOf) });
            }
        }
    }

    const inUse = bins.filter(function (bin)
    {
        return bin.blocks.length > 0;
    });

    const empty = bins.filter(function (bin)
    {
        return bin.blocks.length === 0;
    });

    return inUse.concat(empty);
}

// Small seeded random number generator, so that sorting the same collection always gives the same layout
function seededRandom(seed)
{
    return function ()
    {
        seed = (seed + 0x6D2B79F5) | 0;

        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// How much of a shelf's empty space is broken up, in cm2 of its front: all the empty area except the biggest
// single empty rectangle. Zero means the free space is one clean block; pockets under and between boxes add to it.
function scatteredSpace(bin)
{
    const width = bin.shelf.width;
    const height = bin.shelf.height;

    const edges = function (values, limit)
    {
        const sorted = values.map(function (v)
        {
            return Math.min(limit, Math.max(0, v));
        }).concat([0, limit]).sort(function (a, b)
        {
            return a - b;
        });

        return sorted.filter(function (v, i)
        {
            return i === 0 || v - sorted[i - 1] > EPS;
        });
    };

    const xs = edges(bin.blocks.flatMap(function (b)
    {
        return [b.x, b.x + b.w];
    }), width);

    const ys = edges(bin.blocks.flatMap(function (b)
    {
        return [b.y, b.y + b.h];
    }), height);

    // The shelf front as a grid of cells between every box edge; a cell is free when no box covers its middle
    const free = [];
    let freeArea = 0;

    for (let j = 0; j < ys.length - 1; j++)
    {
        const row = [];
        const midY = (ys[j] + ys[j + 1]) / 2;

        for (let i = 0; i < xs.length - 1; i++)
        {
            const midX = (xs[i] + xs[i + 1]) / 2;
            const covered = bin.blocks.some(function (b)
            {
                return midX > b.x && midX < b.x + b.w && midY > b.y && midY < b.y + b.h;
            });

            row.push(!covered);

            if (!covered)
            {
                freeArea += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
            }
        }

        free.push(row);
    }

    // Biggest empty rectangle: for every band of rows, the widest run of columns that are free all the way up it
    let largest = 0;

    for (let bottom = 0; bottom < free.length; bottom++)
    {
        const open = free[bottom].slice();

        for (let top = bottom; top < free.length; top++)
        {
            let runStart = null;

            for (let i = 0; i <= open.length; i++)
            {
                if (i < open.length)
                {
                    open[i] = open[i] && free[top][i];
                }

                if (i < open.length && open[i])
                {
                    if (runStart === null)
                    {
                        runStart = xs[i];
                    }

                    largest = Math.max(largest, (xs[i + 1] - runStart) * (ys[top + 1] - ys[bottom]));
                }
                else
                {
                    runStart = null;
                }
            }
        }
    }

    return freeArea - largest;
}

// How good a finished layout is, as a score list (lower is better): games left over, then shelves used,
// then how many boxes are hidden away in front rows, then how broken up the empty space on the used shelves is,
// then how far boxes stick out past their shelves in total
function layoutScore(result)
{
    let inFront = 0;
    let overhang = 0;
    let scattered = 0;

    for (const bin of result.bins)
    {
        if (bin.blocks.length > 0)
        {
            scattered += scatteredSpace(bin);
        }
    }

    for (const item of result.placed)
    {
        if (item.block.z > EPS)
        {
            inFront++;
        }

        overhang += Math.max(0, item.block.z + item.block.d - item.shelf.depth);
    }

    return [result.unplaced, result.shelvesUsed, inFront, Math.round(scattered), overhang];
}

// A sort stops trying further layouts after this long, however many it had planned
const SORT_TIME_LIMIT_MS = 12000;

// During a live sort: how long to keep trying layouts before letting the page draw the latest one
const SORT_SLICE_MS = 80;

// True while a live sort is running and the page is showing the layouts it tries
let sorting = false;

// The running live sort, for anything that needs to wait for it; null otherwise
let sortPromise = null;

// How many layouts a sort tries: more for small collections, where each one is quick. Big collections are
// stopped by the time limit first.
function sortPassCount(gameCount)
{
    return Math.min(10000, Math.max(200, Math.round(200000 / gameCount)));
}

// A search for the best layout of the unlocked games around whatever is locked on the shelves, advanced one try
// at a time by step(). Each try is a complete greedy packing of every game:
//  - the first four place the games biggest first (by volume, then by longest side) in each placement style
//  - after that, tries alternate between biggest-first with every size nudged by up to a third, and the best
//    order found so far with a few games moved to a different place in the queue
// Biggest-first matters because the small games are then the ones left to go on top and in front.
// search.best is the best result so far; step() returns the result it just tried.
function createSortSearch(movable, passes)
{
    const volume = function (game)
    {
        return game.height * game.width * game.depth;
    };

    const longest = function (game)
    {
        return Math.max(game.height, game.width, game.depth);
    };

    const random = seededRandom(20261004);

    const byVolume = movable.slice().sort(function (a, b)
    {
        return volume(b) - volume(a);
    });

    const byLongest = movable.slice().sort(function (a, b)
    {
        return longest(b) - longest(a) || volume(b) - volume(a);
    });

    const movableSet = new Set(movable);
    const openers = [[byVolume, "narrow"], [byLongest, "narrow"], [byVolume, "low"], [byLongest, "low"]];
    const search = { pass: 0, passes: passes, best: null, bestOrder: null, bestScoring: null };

    search.step = function ()
    {
        let games;
        let scoring;

        if (search.pass < openers.length)
        {
            games = openers[search.pass][0];
            scoring = openers[search.pass][1];
        }
        else if (search.pass % 2 === 0)
        {
            const keyed = movable.map(function (game)
            {
                return { game: game, key: volume(game) * (0.65 + random() * 0.7) };
            });

            keyed.sort(function (a, b)
            {
                return b.key - a.key;
            });

            games = keyed.map(function (entry)
            {
                return entry.game;
            });

            scoring = random() < 0.5 ? "narrow" : "low";
        }
        else
        {
            games = search.bestOrder.slice();

            for (let moves = 1 + Math.floor(random() * 3); moves > 0; moves--)
            {
                const moved = games.splice(Math.floor(random() * games.length), 1)[0];
                games.splice(Math.floor(random() * (games.length + 1)), 0, moved);
            }

            scoring = random() < 0.8 ? search.bestScoring : (search.bestScoring === "narrow" ? "low" : "narrow");
        }

        const result = packGames(games, makeSortBins(movableSet), scoring);
        result.score = layoutScore(result);
        search.pass++;

        if (!search.best || compareScores(result.score, search.best.score) < 0)
        {
            search.best = result;
            search.bestOrder = games;
            search.bestScoring = scoring;
        }

        return result;
    };

    return search;
}

// Runs a search in one go, without showing it, and returns the best layout. Unless told how many layouts to try
// it makes a much shorter search than the live sort does.
function findBestLayout(movable, passes)
{
    const started = performance.now();
    const search = createSortSearch(movable, passes === undefined ? Math.min(300, sortPassCount(movable.length)) : passes);

    while (search.pass < search.passes && performance.now() - started < SORT_TIME_LIMIT_MS)
    {
        search.step();
    }

    return search.best;
}

// Puts a layout from the sorter onto the shelves: every unlocked game either where the layout has it, turned the
// way the layout has it, or back in unsorted
function applyLayout(result, movable)
{
    for (const game of movable)
    {
        game.placement = null;
    }

    for (const item of result.placed)
    {
        item.game.width = item.block.w;
        item.game.height = item.block.h;
        item.game.depth = item.block.d;
        item.game.placement = { shelfId: item.shelf.id, x: item.block.x, y: item.block.y, z: item.block.z };
    }
}

function describeLayout(result)
{
    return result.shelvesUsed + (result.shelvesUsed === 1 ? " shelf" : " shelves") +
        (result.unplaced ? ", " + result.unplaced + " left over" : "");
}

// Locks the page while a live sort runs, and shows or hides its progress bar
function setSorting(on)
{
    sorting = on;
    document.body.classList.toggle("sorting", on);
    document.querySelector(".toolbar").inert = on;
    document.querySelector(".workspace").inert = on;
    document.getElementById("sortProgress").hidden = !on;
}

// Runs a search in short bursts, drawing the layout it has just tried after each burst, so the page shows the
// search as it happens. Resolves once the best layout is on the shelves.
function runLiveSort(search, movable)
{
    return new Promise(function (resolve)
    {
        const started = performance.now();

        const burst = function ()
        {
            const burstEnd = performance.now() + SORT_SLICE_MS;
            let latest = null;

            while (search.pass < search.passes && performance.now() < burstEnd)
            {
                latest = search.step();
            }

            const elapsed = performance.now() - started;

            if (search.pass >= search.passes || elapsed >= SORT_TIME_LIMIT_MS)
            {
                resolve();
                return;
            }

            applyLayout(latest, movable);
            render();
            showMessage("Trying layout " + search.pass + " of " + search.passes + " · best so far: " + describeLayout(search.best));
            document.getElementById("sortProgressBar").style.width =
                Math.min(100, Math.max(search.pass / search.passes, elapsed / SORT_TIME_LIMIT_MS) * 100) + "%";

            // Hands control back so the browser can draw this layout before the next burst
            setTimeout(burst, 0);
        };

        burst();
    });
}

function finishSort(best, movable)
{
    applyLayout(best, movable);
    render();
    showMessage("Sorted " + best.placed.length + " game(s) onto " + describeLayout(best).replace("left over", "didn't fit anywhere and stay unsorted"));
}

// The Auto-Sort button: asks which kind of sort to run. Sorting everything undoes any arranging done by hand,
// so that choice is confirmed a second time.
function openSortDialog()
{
    const unlocked = state.games.filter(function (game)
    {
        return !game.locked;
    }).length;

    const unsorted = state.games.filter(function (game)
    {
        return !game.placement;
    }).length;

    document.getElementById("sortEverythingCount").textContent = unlocked + (unlocked === 1 ? " game" : " games");
    document.getElementById("sortUnsortedCount").textContent = unsorted + (unsorted === 1 ? " game" : " games");

    openDialog("dlgSort", function (result)
    {
        if (result === "everything")
        {
            if (confirm("Are you sure? Every unlocked game will be taken off the shelves and rearranged. Locked games stay where they are."))
            {
                autoSort(true, false);
            }
        }
        else if (result === "unsorted")
        {
            autoSort(true, true);
        }
    });
}

// Sorts either every unlocked game (taking them all off the shelves first) or, with onlyUnsorted, just the games
// in the unsorted piles, fitting them around everything already shelved.
// live: show every layout as it is tried, which is what the toolbar buttons do. Without it the sort runs in one go.
// Returns a promise that resolves when the sort has finished.
function autoSort(live, onlyUnsorted)
{
    if (sortPromise)
    {
        return sortPromise;
    }

    const movable = state.games.filter(function (game)
    {
        return onlyUnsorted ? !game.placement : !game.locked;
    });

    if (movable.length === 0)
    {
        showMessage(onlyUnsorted ? "Nothing to sort: there are no unsorted games" : "Nothing to sort: every game is locked in place");
        return Promise.resolve();
    }

    if (!onlyUnsorted)
    {
        // Unlocked games come off the shelves; locked ones that were resting on them drop
        for (const game of movable)
        {
            game.placement = null;
        }

        for (const bookcase of state.bookcases)
        {
            for (const shelf of bookcase.shelves)
            {
                settleShelf(shelf.id);
            }
        }
    }

    if (!live)
    {
        finishSort(findBestLayout(movable), movable);
        return Promise.resolve();
    }

    const search = createSortSearch(movable, sortPassCount(movable.length));

    setSorting(true);
    document.getElementById("sortProgressBar").style.width = "0%";

    sortPromise = runLiveSort(search, movable).then(function ()
    {
        setSorting(false);
        sortPromise = null;
        finishSort(search.best, movable);
    });

    return sortPromise;
}

// ---------- Import / export ----------

// Workbook layout: a "Shelves" sheet and a "Games" sheet.
// Shelves has one row per shelf of a bookcase's column, top to bottom, grouped by bookcase number (left to right).
// Columns, Width, Depth and Max Overhang describe the whole bookcase and are read from its first row; Shelf Name,
// Height and Allow Overhang are per shelf, and apply to that shelf in every column.
// A game's Bookcase, Column and Shelf are positions counted from 1 (from the left, from the left, from the top);
// blank means unsorted.
const SHELF_COLUMNS = ["Bookcase", "Bookcase Name", "Columns", "Width", "Depth", "Max Overhang", "Shelf Name", "Height", "Allow Overhang"];
const GAME_COLUMNS = ["Name", "Width", "Height", "Depth", "This Side Up", "Lock In Place", "Bookcase", "Column", "Shelf", "X", "Y", "Z"];

function exportWorkbook()
{
    const shelfRows = [];
    const gameRows = [];
    const positions = new Map();

    state.bookcases.forEach(function (bookcase, bookcaseIndex)
    {
        const perColumn = shelvesPerColumn(bookcase);

        bookcase.shelves.forEach(function (shelf, index)
        {
            positions.set(shelf.id, { bookcase: bookcaseIndex + 1, column: Math.floor(index / perColumn) + 1, shelf: index % perColumn + 1 });
        });

        // The columns are identical, so the first one describes them all
        for (const shelf of columnShelves(bookcase, 0))
        {
            shelfRows.push({
                "Bookcase": bookcaseIndex + 1,
                "Bookcase Name": bookcase.name,
                "Columns": bookcase.columns,
                "Width": shelf.width,
                "Depth": shelf.depth,
                "Max Overhang": bookcase.maxOverhang,
                "Shelf Name": shelf.name,
                "Height": shelf.height,
                "Allow Overhang": shelf.allowOverhang
            });
        }
    });

    // Games are listed alphabetically, like the unsorted piles
    for (const game of state.games.slice().sort(compareByName))
    {
        const position = game.placement ? positions.get(game.placement.shelfId) : null;

        gameRows.push({
            "Name": game.name,
            "Width": game.width,
            "Height": game.height,
            "Depth": game.depth,
            "This Side Up": game.rotationLocked,
            "Lock In Place": game.locked,
            "Bookcase": position ? position.bookcase : "",
            "Column": position ? position.column : "",
            "Shelf": position ? position.shelf : "",
            "X": position ? game.placement.x : "",
            "Y": position ? game.placement.y : "",
            "Z": position ? game.placement.z : ""
        });
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(gameRows, { header: GAME_COLUMNS }), "Games");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(shelfRows, { header: SHELF_COLUMNS }), "Shelves");
    XLSX.writeFile(workbook, "GameSorter.xlsx");
    showMessage("Exported " + gameRows.length + " games and " + state.bookcases.length + " bookcase(s)");
}

// Rows as objects keyed by header, with headers reduced to lower-case letters and digits ("Allow Overhang" -> "allowoverhang")
function readSheetRows(sheet)
{
    return XLSX.utils.sheet_to_json(sheet, { defval: "" }).map(function (raw)
    {
        const row = {};

        for (const key of Object.keys(raw))
        {
            row[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = raw[key];
        }

        return row;
    });
}

function cellText(value)
{
    return value === undefined ? "" : String(value).trim();
}

function cellBool(value, fallback)
{
    const text = cellText(value).toLowerCase();

    if (text === "")
    {
        return fallback;
    }

    return ["true", "yes", "y", "1", "x"].includes(text);
}

function hasValidDims(row)
{
    return Number(row.width) > 0 && Number(row.height) > 0 && Number(row.depth) > 0;
}

// Picks out the games and shelves sheets by sheet name, falling back to their column headers (for CSV)
function classifySheets(workbook)
{
    const found = { games: null, shelves: null };

    for (const sheetName of workbook.SheetNames)
    {
        const rows = readSheetRows(workbook.Sheets[sheetName]);
        const first = rows[0] || {};
        const lowered = sheetName.toLowerCase();
        let kind = null;

        if (lowered.includes("shel") || lowered.includes("bookcase"))
        {
            kind = "shelves";
        }
        else if (lowered.includes("game"))
        {
            kind = "games";
        }
        else if ("allowoverhang" in first || "bookcasename" in first || "shelfname" in first)
        {
            kind = "shelves";
        }
        else if ("height" in first)
        {
            kind = "games";
        }

        if (kind && !found[kind])
        {
            found[kind] = rows;
        }
    }

    return found;
}

// Returns { bookcases, skipped }
function buildBookcases(rows)
{
    const groups = [];
    let currentKey = null;
    let skipped = 0;

    // Gather each bookcase's shelf rows. A change of bookcase number (or name, when there is no number) starts
    // the next bookcase.
    for (const row of rows)
    {
        if (!(Number(row.height) > 0))
        {
            skipped++;
            continue;
        }

        const key = cellText(row.bookcase) !== "" ? "#" + cellText(row.bookcase) : "name:" + cellText(row.bookcasename);

        if (key !== currentKey)
        {
            groups.push([]);
            currentKey = key;
        }

        groups[groups.length - 1].push(row);
    }

    const bookcases = [];

    for (const group of groups)
    {
        // What belongs to the whole bookcase comes from the first of its rows that gives it
        const firstNumber = function (key, fallback)
        {
            const found = group.find(function (row)
            {
                return cellText(row[key]) !== "" && Number(row[key]) >= 0;
            });

            return found ? Number(found[key]) : fallback;
        };

        const width = firstNumber("width", 0);
        const depth = firstNumber("depth", 0);

        if (!(width > 0) || !(depth > 0))
        {
            skipped += group.length;
            continue;
        }

        const bookcase =
        {
            id: nextId++,
            name: cellText(group[0].bookcasename),
            columns: Math.max(1, Math.round(firstNumber("columns", 1))),
            shelves: [],
            maxOverhang: firstNumber("maxoverhang", DEFAULT_MAX_OVERHANG)
        };

        for (let column = 0; column < bookcase.columns; column++)
        {
            for (const row of group)
            {
                bookcase.shelves.push(makeShelf(cellText(row.shelfname), width, Number(row.height), depth, cellBool(row.allowoverhang, true)));
            }
        }

        bookcases.push(bookcase);
    }

    return { bookcases: bookcases, skipped: skipped };
}

// Returns { games, skipped }. Placements are resolved against the given bookcases.
function buildGames(rows, bookcases)
{
    const games = [];
    let skipped = 0;

    for (const row of rows)
    {
        if (!hasValidDims(row))
        {
            skipped++;
            continue;
        }

        const game = makeGame(cellText(row.name), Number(row.width), Number(row.height), Number(row.depth));
        // "Lock Rotation" is the column's old name
        game.rotationLocked = cellBool(row.thissideup !== undefined ? row.thissideup : row.lockrotation, false);

        // Column is left out of files written before bookcases had columns
        const bookcase = bookcases[Number(row.bookcase) - 1];
        const column = Math.max(1, Number(row.column) || 1);
        const shelfNumber = Number(row.shelf);
        const perColumn = bookcase ? shelvesPerColumn(bookcase) : 0;
        const shelf = bookcase && column <= bookcase.columns && shelfNumber >= 1 && shelfNumber <= perColumn
            ? bookcase.shelves[(column - 1) * perColumn + shelfNumber - 1]
            : null;

        if (shelf)
        {
            game.placement = { shelfId: shelf.id, x: Number(row.x) || 0, y: Number(row.y) || 0, z: Number(row.z) || 0 };
            game.locked = cellBool(row.lockinplace, false);
        }

        games.push(game);
    }

    return { games: games, skipped: skipped };
}

// Unshelves any game whose placement is out of bounds or overlaps another. Returns how many were unshelved.
function dropBadPlacements()
{
    let dropped = 0;

    for (const game of state.games)
    {
        if (game.placement && !findShelf(game.placement.shelfId))
        {
            unshelve(game);
            dropped++;
        }
    }

    for (const bookcase of state.bookcases)
    {
        for (const shelf of bookcase.shelves)
        {
            const accepted = [];
            const boxes = gamesOnShelf(shelf.id).sort(function (a, b)
            {
                return a.placement.y - b.placement.y;
            });

            for (const game of boxes)
            {
                const clashes = accepted.some(function (other)
                {
                    return overlaps(game, other);
                });

                if (clashes || !fitsShelf(game, shelf))
                {
                    unshelve(game);
                    dropped++;
                }
                else
                {
                    accepted.push(game);
                }
            }

            settleShelf(shelf.id);
        }
    }

    return dropped;
}

function importWorkbook(workbook)
{
    const sheets = classifySheets(workbook);

    if (!sheets.games && !sheets.shelves)
    {
        showMessage("Import failed: no Games or Shelves sheet with Width, Height and Depth columns was found");
        return;
    }

    const shelfResult = sheets.shelves ? buildBookcases(sheets.shelves) : null;

    if (shelfResult && shelfResult.bookcases.length === 0)
    {
        showMessage("Import failed: the Shelves sheet has no bookcase with a valid Width, Depth and shelf Height");
        return;
    }

    const replacing = [sheets.games ? "games" : "", sheets.shelves ? "bookcases" : ""].filter(Boolean).join(" and ");

    if (!confirm("Importing replaces your current " + replacing + ". Continue?"))
    {
        return;
    }

    let skipped = 0;

    if (shelfResult)
    {
        state.bookcases = shelfResult.bookcases;
        skipped += shelfResult.skipped;
    }

    if (sheets.games)
    {
        const gameResult = buildGames(sheets.games, state.bookcases);
        state.games = gameResult.games;
        skipped += gameResult.skipped;
    }

    const dropped = dropBadPlacements();

    render();
    fitScale();
    showMessage("Imported " + replacing +
        (skipped ? " · skipped " + skipped + " row(s) without valid dimensions" : "") +
        (dropped ? " · " + dropped + " game(s) didn't fit their saved spot and moved to unsorted" : ""));
}

function importFile(file)
{
    file.arrayBuffer().then(function (buffer)
    {
        importWorkbook(XLSX.read(buffer));
    }).catch(function (error)
    {
        showMessage("Import failed: " + error.message);
    });
}

function initImportExport()
{
    const fileInput = document.getElementById("fileImport");

    document.getElementById("btnImport").addEventListener("click", function ()
    {
        fileInput.click();
    });

    fileInput.addEventListener("change", function ()
    {
        if (fileInput.files.length > 0)
        {
            importFile(fileInput.files[0]);
        }

        // Cleared so picking the same file again still fires a change
        fileInput.value = "";
    });

    document.getElementById("btnExport").addEventListener("click", exportWorkbook);
}

// ---------- Startup ----------

function init()
{
    if (!loadState())
    {
        loadDefaults();
    }

    render();
    fitScale();
    initDialogs();
    initBookcaseDrag();
    initBoxDrag();
    initImportExport();
    initTopView();

    document.getElementById("btnUnshelve").addEventListener("click", unshelveUnlocked);
    document.getElementById("btnAutoSort").addEventListener("click", openSortDialog);
    document.getElementById("btnReset").addEventListener("click", resetAll);
    document.getElementById("btnClear").addEventListener("click", clearGames);

    document.getElementById("btnView2d").addEventListener("click", function ()
    {
        setViewMode(false);
    });

    document.getElementById("btnView3d").addEventListener("click", function ()
    {
        setViewMode(true);
    });

    document.getElementById("bookcases").addEventListener("click", function (e)
    {
        const topButton = e.target.closest(".top-view-button");

        if (topButton)
        {
            openTopView(Number(topButton.dataset.shelf));
        }
    });

    document.getElementById("zoom").addEventListener("input", function (e)
    {
        setScale(Number(e.target.value));
    });

    document.getElementById("btnFit").addEventListener("click", fitScale);

    document.getElementById("btnAddGame").addEventListener("click", function ()
    {
        openGameDialog(null);
    });

    document.getElementById("btnAddBookcase").addEventListener("click", function ()
    {
        openBookcaseDialog(null);
    });

    document.querySelector(".workspace").addEventListener("dblclick", function (e)
    {
        const box = e.target.closest(".box");
        const bookcase = e.target.closest(".bookcase");

        if (e.target.closest(".top-view-button"))
        {
            return;
        }

        if (box)
        {
            openGameDialog(findGame(Number(box.dataset.id)));
        }
        else if (bookcase)
        {
            openBookcaseDialog(findBookcase(Number(bookcase.dataset.id)));
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
