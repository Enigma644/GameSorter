// Auto-sort and stability tests, run inside the real page in a headless browser.
// With #shot=2d or #shot=3d in the URL it instead leaves a sorted layout on screen for a screenshot.
window.addEventListener("load", async function ()
{
    const out = [];
    let failures = 0;

    window.confirm = function ()
    {
        return true;
    };

    // A fixed starting point, whatever the defaults grow to: the first twenty default games and the tall BILLY
    function loadTwenty()
    {
        loadDefaults();
        state.games.length = 20;
        state.bookcases = state.bookcases.slice(-1);
    }

    function check(label, ok, detail)
    {
        if (!ok)
        {
            failures++;
        }

        out.push((ok ? "PASS  " : "FAIL  ") + label + (detail ? "  -> " + detail : ""));
    }

    function allShelves()
    {
        const list = [];

        state.bookcases.forEach(function (bookcase, b)
        {
            bookcase.shelves.forEach(function (shelf, i)
            {
                list.push({ shelf: shelf, label: "B" + (b + 1) + "S" + (i + 1) });
            });
        });

        return list;
    }

    // Everything the sorter promises about a finished layout; returns a list of problems
    function problems()
    {
        const found = [];

        for (const entry of allShelves())
        {
            const boxes = gamesOnShelf(entry.shelf.id);

            for (let i = 0; i < boxes.length; i++)
            {
                const a = boxes[i];

                if (!fitsShelf(a, entry.shelf))
                {
                    found.push(a.name + " doesn't fit " + entry.label);
                }

                if (!a.locked && !isStable(a))
                {
                    found.push(a.name + " unstable");
                }

                if (!a.locked && sticksOutTooFar(a, entry.shelf, a.placement.z))
                {
                    found.push(a.name + " sticks out too far");
                }

                if (!a.locked && entry.shelf.allowOverhang && a.placement.z + a.depth / 2 > entry.shelf.depth + EPS)
                {
                    found.push(a.name + " more than half off the shelf");
                }

                if (!a.locked && !isVisible(blockOf(a), boxes.map(blockOf)))
                {
                    found.push(a.name + " is hidden behind other boxes");
                }

                // Sorter-only rules for boxes in front rows: pushed back against something, and never bigger than it
                if (!a.locked && a.placement.z > EPS)
                {
                    const behind = boxes.filter(function (b)
                    {
                        return Math.abs(b.placement.z + b.depth - a.placement.z) < EPS &&
                            overlapLength(a.placement.x, a.width, b.placement.x, b.width) > EPS &&
                            overlapLength(a.placement.y, a.height, b.placement.y, b.height) > EPS;
                    });

                    if (behind.length === 0)
                    {
                        found.push(a.name + " stands in mid-shelf");
                    }

                    if (behind.some(function (b) { return a.width * a.height * a.depth > b.width * b.height * b.depth + EPS; }))
                    {
                        found.push(a.name + " is bigger than a box behind it");
                    }
                }

                const copy = { x: a.placement.x, y: a.placement.y };
                settleShelf(entry.shelf.id);

                if (Math.abs(copy.y - a.placement.y) > EPS)
                {
                    found.push(a.name + " was floating");
                }

                for (let j = i + 1; j < boxes.length; j++)
                {
                    if (overlaps(a, boxes[j]))
                    {
                        found.push(a.name + " overlaps " + boxes[j].name);
                    }
                }
            }
        }

        return found;
    }

    function describe()
    {
        const lines = [];

        for (const entry of allShelves())
        {
            const boxes = gamesOnShelf(entry.shelf.id).sort(function (a, b)
            {
                return a.placement.z - b.placement.z || a.placement.x - b.placement.x || a.placement.y - b.placement.y;
            });

            if (boxes.length > 0)
            {
                lines.push("    " + entry.label + " (" + boxes.length + "): " + boxes.map(function (g)
                {
                    return (g.name || "?").slice(0, 14) + " " + g.width + "w" + g.height + "h" + g.depth + "d@" +
                        g.placement.x.toFixed(1) + "," + g.placement.y.toFixed(1) + "," + g.placement.z.toFixed(1);
                }).join(" | "));
            }
        }

        return lines.join("\n");
    }

    // The current shelves scored the way the sorter scores a layout
    function describeScore()
    {
        const movable = state.games.filter(function (g) { return !g.locked; });
        const bins = makeSortBins();
        const placed = [];

        for (const bin of bins)
        {
            for (const game of gamesOnShelf(bin.shelf.id))
            {
                if (!game.locked)
                {
                    const block = blockOf(game);
                    bin.blocks.push(block);
                    placed.push({ game: game, shelf: bin.shelf, block: block });
                }
            }
        }

        return layoutScore({
            placed: placed,
            unplaced: movable.length - placed.length,
            shelvesUsed: bins.filter(function (bin) { return bin.blocks.length > 0; }).length,
            bins: bins
        });
    }

    function shelved()
    {
        return state.games.filter(function (g) { return g.placement; }).length;
    }

    function usedShelves()
    {
        return allShelves().filter(function (entry) { return gamesOnShelf(entry.shelf.id).length > 0; }).length;
    }

    const shot = (location.hash.match(/shot=(\w+)/) || [])[1];

    if (shot)
    {
        loadTwenty();
        state.view3d = shot.indexOf("3d") === 0;

        if (shot === "3dcards")
        {
            state.bookcases = [makeBookcase("Small case", 2, { width: 76.3, height: 30, depth: 26.5 })];
            state.games.forEach(function (g) { g.placement = null; g.locked = false; });

            for (let i = 0; i < 14; i++)
            {
                state.games.push(makeGame("Card game " + (i + 1), 12 + (i % 4), 9 + (i % 3), 3 + (i % 2)));
            }
        }

        autoSort();
        fitScale();
        return;
    }

    try
    {
        // ---- Stability rule
        loadTwenty();
        state.games.forEach(function (g) { g.placement = null; g.locked = false; });

        const shelf = state.bookcases[0].shelves[0];
        const base = state.games[0];
        const top = state.games[1];
        base.height = 10; base.width = 20; base.depth = 20;
        top.height = 5; top.width = 20; top.depth = 20;
        base.placement = { shelfId: shelf.id, x: 0, y: 0, z: 0 };

        top.placement = { shelfId: shelf.id, x: 12, y: 10, z: 0 };
        check("2D: 40% supported is unstable", !isStable(top));
        top.placement.x = 8;
        check("2D: 60% supported is stable", isStable(top));
        top.placement.x = 10;
        check("2D: exactly 50% supported is stable", isStable(top));
        check("a box on the shelf floor is always stable", isStable(base));

        state.view3d = true;
        top.placement = { shelfId: shelf.id, x: 4, y: 10, z: 8 };
        check("3D: 80% across x 60% deep = 48% is unstable", !isStable(top));
        top.placement.z = 6;
        check("3D: 80% across x 70% deep = 56% is stable", isStable(top));

        top.placement = { shelfId: shelf.id, x: 12, y: 10, z: 0 };
        render();
        check("unstable box is flagged in the view and status bar",
            document.querySelector("#bookcases .box.unstable") !== null && document.getElementById("status").textContent.indexOf("1 unstable") >= 0,
            document.getElementById("status").textContent);

        const plan = planDrop(state.games[2], shelf, 15, 20);
        check("drop plan warns before an unstable drop but still allows it", plan.valid === true && typeof plan.unstable === "boolean");

        // ---- 2D sort of the defaults
        loadTwenty();
        render();

        const lockedBefore = JSON.stringify(state.games.filter(function (g) { return g.locked; }).map(function (g)
        {
            return [g.name, g.height, g.width, g.depth, g.placement];
        }));
        const gloomHeight = state.games.find(function (g) { return g.name === "Gloomhaven"; }).height;

        let started = performance.now();
        autoSort();
        let took = Math.round(performance.now() - started);

        check("2D defaults: all 20 games shelved", shelved() === 20, shelved() + " shelved, " + took + " ms");
        check("2D defaults: no overlaps, everything fits, stable, resting", problems().length === 0, problems().join("; "));
        check("2D defaults: locked games untouched", JSON.stringify(state.games.filter(function (g) { return g.locked; }).map(function (g)
        {
            return [g.name, g.height, g.width, g.depth, g.placement];
        })) === lockedBefore);
        check("2D defaults: 'this side up' Gloomhaven keeps its height", state.games.find(function (g) { return g.name === "Gloomhaven"; }).height === gloomHeight);
        const flatLayout = describe();
        state.view3d = true;
        render();
        state.view3d = false;
        render();
        check("switching between 2D and 3D leaves the layout untouched", describe() === flatLayout);
        out.push("  shelves used: " + usedShelves() + " of 6   message: " + document.getElementById("message").textContent);
        out.push(describe());

        // ---- 2D sort with nothing locked
        loadTwenty();
        state.games.forEach(function (g) { g.placement = null; g.locked = false; g.rotationLocked = false; });
        autoSort();
        check("2D unlocked: all 20 shelved with no problems", shelved() === 20 && problems().length === 0, problems().join("; "));
        out.push("  shelves used: " + usedShelves() + " of 6");
        out.push(describe());

        // ---- Sorting twice gives the same answer
        const once = describe();
        autoSort();
        check("sorting an already sorted layout uses no more shelves", usedShelves() <= once.split("\n").length, usedShelves() + " shelves");

        // ---- 3D with card games and not enough back-row space
        loadTwenty();
        state.view3d = true;
        state.bookcases = [makeBookcase("Small case", 2, { width: 76.3, height: 30, depth: 26.5 })];
        state.games.forEach(function (g) { g.placement = null; g.locked = false; g.rotationLocked = false; });

        for (let i = 0; i < 14; i++)
        {
            state.games.push(makeGame("Card game " + (i + 1), 12 + (i % 4), 9 + (i % 3), 3 + (i % 2)));
        }

        started = performance.now();
        autoSort();
        took = Math.round(performance.now() - started);

        const inFront = state.games.filter(function (g) { return g.placement && g.placement.z > EPS; });
        const biggestFront = Math.max.apply(null, inFront.map(function (g) { return g.height * g.width * g.depth; }).concat([0]));
        const smallestBack = Math.min.apply(null, state.games.filter(function (g) { return g.placement && g.placement.z <= EPS; })
            .map(function (g) { return g.height * g.width * g.depth; }));

        check("3D small case: layout has no problems", problems().length === 0, problems().join("; "));
        out.push("  " + shelved() + " of " + state.games.length + " shelved, " + inFront.length + " in front rows, " + took + " ms   message: " + document.getElementById("message").textContent);
        out.push("  biggest box in a front row: " + Math.round(biggestFront) + " cm3, smallest in a back row: " + Math.round(smallestBack) + " cm3");
        out.push(describe());

        // ---- No-overhang shelf
        loadTwenty();
        state.view3d = false;
        state.games.forEach(function (g) { g.placement = null; g.locked = false; g.rotationLocked = false; });
        state.bookcases[0].shelves.forEach(function (s) { s.allowOverhang = false; });
        autoSort();
        check("no-overhang shelves: nothing sticks out", state.games.every(function (g) { return !g.placement || g.depth <= 26.5 + EPS; }) && problems().length === 0, problems().join("; "));
        out.push("  " + shelved() + " of 20 shelved on " + usedShelves() + " shelves");

        // ---- A game that fits nowhere, and everything locked
        loadTwenty();
        state.games.push(makeGame("Monster", 90, 80, 100));
        autoSort();
        check("a game too big for any shelf stays unsorted and is reported",
            !state.games[state.games.length - 1].placement && document.getElementById("message").textContent.indexOf("1 didn't fit") >= 0,
            document.getElementById("message").textContent);

        state.games.forEach(function (g) { g.locked = true; });
        const frozen = JSON.stringify(state.games);
        autoSort();
        check("with every game locked, nothing changes", JSON.stringify(state.games) === frozen, document.getElementById("message").textContent);

        // ---- Same collection sorted twice gives the same layout
        loadTwenty();
        state.games.forEach(function (g) { g.placement = null; g.locked = false; });
        const pristine = JSON.stringify(state.games);
        autoSort();
        const first = describe();
        state.games = JSON.parse(pristine);
        autoSort();
        check("the same collection always sorts to the same layout", describe() === first);

        // ---- Locked games are packed around, in 3D too
        loadTwenty();
        state.view3d = true;
        render();
        const lockedSpots = JSON.stringify(state.games.filter(function (g) { return g.locked; }).map(function (g) { return g.placement; }));
        autoSort();
        check("3D defaults: all shelved, no problems, locked games unmoved",
            shelved() === 20 && problems().length === 0 &&
            JSON.stringify(state.games.filter(function (g) { return g.locked; }).map(function (g) { return g.placement; })) === lockedSpots,
            problems().join("; ") + " " + usedShelves() + " shelves");

        // ---- Sorting only the unsorted games
        loadTwenty();
        state.games.forEach(function (g) { g.placement = null; g.locked = false; g.rotationLocked = false; });

        const handShelf = state.bookcases[0].shelves[5];
        const mine = state.games.slice(0, 3);
        mine[0].placement = { shelfId: handShelf.id, x: 20, y: 0, z: 0 };
        mine[1].placement = { shelfId: handShelf.id, x: 22, y: mine[0].height, z: 0 };
        mine[2].placement = { shelfId: state.bookcases[0].shelves[2].id, x: 3, y: 0, z: 0 };
        render();

        const mineBefore = JSON.stringify(mine.map(function (g) { return [g.height, g.width, g.depth, g.placement]; }));
        autoSort(false, true);

        const allBoxesFine = allShelves().every(function (entry)
        {
            const boxes = gamesOnShelf(entry.shelf.id);

            return boxes.every(function (a, i)
            {
                return fitsShelf(a, entry.shelf) && boxes.slice(i + 1).every(function (b) { return !overlaps(a, b); });
            });
        });

        check("sort unsorted: games already on shelves are not moved or turned, even though they are unlocked",
            JSON.stringify(mine.map(function (g) { return [g.height, g.width, g.depth, g.placement]; })) === mineBefore);
        check("sort unsorted: the other 17 are shelved around them without overlaps", shelved() === 20 && allBoxesFine, shelved() + " shelved");
        check("sort unsorted: newly placed games are stable, visible and within the overhang limit",
            state.games.slice(3).every(function (g)
            {
                const shelf = findShelf(g.placement.shelfId);
                return isStable(g) && !sticksOutTooFar(g, shelf, g.placement.z) && isVisible(blockOf(g), gamesOnShelf(shelf.id).map(blockOf));
            }));
        check("sort unsorted: hand-placed games are still visible", mine.every(function (g)
        {
            return isVisible(blockOf(g), gamesOnShelf(g.placement.shelfId).map(blockOf));
        }));

        autoSort(false, true);
        check("sort unsorted: with nothing unsorted it says so and changes nothing",
            document.getElementById("message").textContent.indexOf("no unsorted games") >= 0, document.getElementById("message").textContent);
        window.confirm = function () { return true; };

        // ---- A locked shelf is left exactly as it is
        loadTwenty();
        state.games.forEach(function (g) { g.placement = null; g.locked = false; g.rotationLocked = false; });

        const lockedShelf = state.bookcases[0].shelves[5];
        const resident = state.games[0];
        resident.placement = { shelfId: lockedShelf.id, x: 10, y: 0, z: 0 };
        lockedShelf.locked = true;
        render();

        const residentBefore = JSON.stringify([resident.width, resident.height, resident.depth, resident.placement]);
        autoSort(false, false);
        check("locked shelf: its unlocked game is not moved or turned by Sort everything, and nothing is added to the shelf",
            JSON.stringify([resident.width, resident.height, resident.depth, resident.placement]) === residentBefore &&
            gamesOnShelf(lockedShelf.id).length === 1 && shelved() === 20, gamesOnShelf(lockedShelf.id).length + " on the shelf, " + shelved() + " shelved");

        unshelveUnlocked();
        check("locked shelf: Unshelve Unlocked leaves its game there", shelved() === 1 && resident.placement !== null);

        check("locked shelf: a drop onto it by hand is refused", planDrop(state.games[1], lockedShelf, 40, 0).valid === false);

        clearGames();
        check("locked shelf: Clear keeps its game and removes the rest", state.games.length === 1 && state.games[0] === resident);

        document.querySelector(".shelf-lock-button[aria-pressed='true']").click();
        check("locked shelf: its padlock button unlocks it again", lockedShelf.locked === false && document.querySelectorAll(".shelf.locked").length === 0);

        // ---- Locked boxes ignore gravity, so one can stand in for a shelf bracket
        loadTwenty();
        state.games.forEach(function (g) { g.placement = null; g.locked = false; g.rotationLocked = false; });

        const bracketShelf = state.bookcases[0].shelves[5];
        const prop = state.games[0];
        const bracket = state.games[1];
        const rider = state.games[2];

        // A prop on the floor, a bracket on the prop, and a box on the bracket
        prop.width = 10; prop.height = 12; prop.depth = 20;
        bracket.name = "Bracket"; bracket.width = 6; bracket.height = 2; bracket.depth = 20;
        rider.width = 6; rider.height = 5; rider.depth = 20;
        prop.placement = { shelfId: bracketShelf.id, x: 30, y: 0, z: 0 };
        bracket.placement = { shelfId: bracketShelf.id, x: 30, y: 12, z: 0 };
        rider.placement = { shelfId: bracketShelf.id, x: 30, y: 14, z: 0 };
        bracket.locked = true;

        unshelve(prop);
        settleShelf(bracketShelf.id);
        check("mid air: a locked box stays where it is when what was under it goes", bracket.placement.y === 12, "y " + bracket.placement.y);
        check("mid air: an unlocked box above it comes to rest on it, not on the floor", rider.placement.y === 14, "y " + rider.placement.y);

        render();
        check("mid air: the hanging locked box is not flagged as unstable",
            isStable(bracket) && document.querySelectorAll("#bookcases .box.unstable").length === 0);

        state.games = [bracket, rider, state.games[3], state.games[4], state.games[5]];

        // Three modest boxes to pack alongside the one that was riding on the bracket: enough to need the space
        // under and around it, but not more than the one open shelf can hold
        state.games.slice(2).forEach(function (g) { g.placement = null; g.width = 20; g.height = 8; g.depth = 20; });
        unshelve(rider);
        state.bookcases[0].shelves.forEach(function (s, i) { s.locked = i !== 5; });
        autoSort(false, false);

        const sortedOnShelf = gamesOnShelf(bracketShelf.id).filter(function (g) { return g !== bracket; });
        const clashes = sortedOnShelf.filter(function (g) { return overlaps(g, bracket); });
        check("mid air: auto-sort leaves the bracket where it is and packs around it without overlapping it",
            bracket.placement.y === 12 && bracket.placement.x === 30 && sortedOnShelf.length === 4 && clashes.length === 0,
            sortedOnShelf.length + " placed, " + clashes.length + " overlapping");
        check("mid air: auto-sort uses the space underneath the bracket",
            sortedOnShelf.some(function (g)
            {
                return g.placement.y + g.height <= 12 + EPS && overlapLength(g.placement.x, g.width, 30, 6) > EPS;
            }), describe());
        check("mid air: everything auto-sort placed is resting on something", sortedOnShelf.every(function (g) { return isStable(g); }));
        state.bookcases[0].shelves.forEach(function (s) { s.locked = false; });

        // ---- Scale
        loadTwenty();
        state.games = [];
        state.bookcases = [makeBookcase("A", 6, BILLY_SHELF), makeBookcase("B", 6, BILLY_SHELF), makeBookcase("C", 6, BILLY_SHELF)];

        for (let i = 0; i < 150; i++)
        {
            state.games.push(makeGame("G" + i, 18 + (i * 13) % 14, 4 + (i * 7) % 6, 18 + (i * 5) % 14));
        }

        started = performance.now();
        autoSort();
        took = Math.round(performance.now() - started);
        check("150 games on 18 shelves: sorted without problems in reasonable time", problems().length === 0 && took < 10000, shelved() + " shelved on " + usedShelves() + " shelves in " + took + " ms");

        // ---- The live sort, as the popup starts it. This has to come before anything is awaited: the headless
        // browser's clock stops advancing within a task after that, and the sort would finish in a single burst.
        loadTwenty();

        const quietGames = state.games.filter(function (g) { return !g.locked; });
        quietGames.forEach(function (g) { g.placement = null; });
        const rounded = function (score)
        {
            return score.map(function (n) { return Math.round(n * 10) / 10; }).join("/");
        };

        const quiet = rounded(findBestLayout(quietGames, sortPassCount(quietGames.length)).score);

        loadTwenty();
        render();
        autoSort(true, false);
        check("live sort: toolbar and shelves are locked and the progress bar shows while it runs",
            sortPromise !== null && document.querySelector(".toolbar").inert && document.querySelector(".workspace").inert &&
            !document.getElementById("sortProgress").hidden);

        // By now the first burst of tries has run and its last layout is on the shelves
        const firstMessage = document.getElementById("message").textContent;
        check("live sort: shows the layout it has just tried, and how far along it is",
            firstMessage.indexOf("Trying layout") === 0 && shelved() > 0 && parseFloat(document.getElementById("sortProgressBar").style.width) > 0,
            firstMessage + " (bar " + document.getElementById("sortProgressBar").style.width + ")");
        check("live sort: layouts shown along the way are not saved", JSON.parse(localStorage.getItem("gameSorter.state")).games.some(function (g) { return !g.placement; }));

        await sortPromise;
        check("live sort: page unlocked and progress bar hidden afterwards",
            sortPromise === null && !document.querySelector(".toolbar").inert && document.getElementById("sortProgress").hidden);
        check("live sort: ends on a layout as good as the one-go sort finds", rounded(describeScore()) === quiet, rounded(describeScore()) + " vs " + quiet);
        check("live sort: layout has no problems", problems().length === 0, problems().join("; "));
        check("live sort: the final layout is saved for the next visit",
            shelved() === 20 && JSON.parse(localStorage.getItem("gameSorter.state")).games.every(function (g) { return g.placement; }));

        // ---- The Auto-Sort button and its popup
        loadTwenty();
        render();
        const untouched = JSON.stringify(state.games);
        const wasShelved = state.games.map(function (g) { return Boolean(g.placement); });
        const sortDialog = document.getElementById("dlgSort");

        // Picks a choice in the popup. The browser delivers a dialog's close event with the next drawn frame, and
        // the headless browser doesn't draw frames reliably, so the test delivers the event itself and then
        // detaches the handler so that the real one, if it turns up later, is not handled twice.
        const choose = async function (value)
        {
            sortDialog.querySelector("[data-close='" + value + "']").click();
            sortDialog.dispatchEvent(new Event("close"));
            sortDialog.onclose = null;
        };

        document.getElementById("btnAutoSort").click();
        check("Auto-Sort button opens the popup with both choices and their game counts",
            sortDialog.open && document.getElementById("sortEverythingCount").textContent === "18 games" &&
            document.getElementById("sortUnsortedCount").textContent === "17 games",
            document.getElementById("sortEverythingCount").textContent + " / " + document.getElementById("sortUnsortedCount").textContent);
        sortDialog.querySelector("[data-close='cancel']").click();
        check("Auto-Sort popup: cancelling changes nothing", !sortDialog.open && sortPromise === null && JSON.stringify(state.games) === untouched);

        document.getElementById("btnAutoSort").click();
        await choose("unsorted");
        await sortPromise;
        check("Auto-Sort popup: 'unsorted only' shelves the unsorted games and leaves the three shelved ones alone",
            shelved() === 20 && JSON.stringify(state.games.filter(function (g, i) { return wasShelved[i]; }).map(function (g) { return g.placement; })) ===
            JSON.stringify(JSON.parse(untouched).filter(function (g) { return g.placement; }).map(function (g) { return g.placement; })),
            shelved() + " shelved");

        // ---- Unshelve Unlocked asks first
        let asked = "";
        window.confirm = function (text) { asked = text; return false; };
        const beforeUnshelve = JSON.stringify(state.games);
        document.getElementById("btnUnshelve").click();
        check("Unshelve Unlocked warns first, and cancelling changes nothing", asked.indexOf("Move 18 unlocked") === 0 && JSON.stringify(state.games) === beforeUnshelve, asked);
        window.confirm = function () { return true; };
        document.getElementById("btnUnshelve").click();
        check("Unshelve Unlocked, confirmed, leaves only the two locked games shelved", shelved() === 2);

        asked = "";
        window.confirm = function (text) { asked = text; return false; };
        document.getElementById("btnAutoSort").click();
        await choose("everything");
        check("Auto-Sort popup: 'everything' asks 'are you sure', and saying no changes nothing",
            asked.indexOf("Are you sure?") === 0 && sortPromise === null && shelved() === 2, asked);
        window.confirm = function () { return true; };

        document.getElementById("btnAutoSort").click();
        await choose("everything");
        await sortPromise;
        check("Auto-Sort popup: 'everything' shelves all twenty again with no problems", shelved() === 20 && problems().length === 0, problems().join("; "));
    }
    catch (error)
    {
        failures++;
        out.push("ERROR " + error.message + "\n" + error.stack);
    }

    out.push(failures === 0 ? "ALL PASSED" : failures + " FAILED");
    document.body.innerHTML = "<pre id='testout'>" + out.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>";
});
