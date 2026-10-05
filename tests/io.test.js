// Import/export round-trip tests, run inside the real page in a headless browser
window.addEventListener("load", function ()
{
    const out = [];
    let failures = 0;

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

    // A comparable picture of the state that doesn't depend on ids
    function snapshot()
    {
        const positions = new Map();

        state.bookcases.forEach(function (bookcase, b)
        {
            bookcase.shelves.forEach(function (shelf, i)
            {
                positions.set(shelf.id, [b, i]);
            });
        });

        return JSON.stringify({
            bookcases: state.bookcases.map(function (bookcase)
            {
                return {
                    name: bookcase.name,
                    columns: bookcase.columns,
                    maxOverhang: bookcase.maxOverhang,
                    shelves: bookcase.shelves.map(function (s)
                    {
                        return [s.name, s.height, s.width, s.depth, s.allowOverhang, Boolean(s.locked)];
                    })
                };
            }),
            // Export lists games alphabetically, so the order they are held in is not part of the comparison
            games: state.games.map(function (g)
            {
                return JSON.stringify([g.name, g.height, g.width, g.depth, g.rotationLocked, g.locked,
                    g.placement ? positions.get(g.placement.shelfId).concat([g.placement.x, g.placement.y, g.placement.z]) : null]);
            }).sort()
        });
    }

    function message()
    {
        return document.getElementById("message").textContent;
    }

    try
    {
        window.confirm = function ()
        {
            return true;
        };

        let captured = null;
        let capturedName = "";

        XLSX.writeFile = function (workbook, name)
        {
            captured = workbook;
            capturedName = name;
        };

        // ---- 1. Round trip of the defaults
        loadTwenty();
        render();

        const defaults = snapshot();
        exportWorkbook();
        check("export produces a workbook named GameSorter.xlsx", captured && capturedName === "GameSorter.xlsx", capturedName);
        check("workbook has Games and Shelves sheets", captured.SheetNames.join(",") === "Games,Shelves", captured.SheetNames.join(","));

        let bytes = XLSX.write(captured, { type: "array", bookType: "xlsx" });
        check("workbook serialises to xlsx bytes", bytes.byteLength > 1000, bytes.byteLength + " bytes");

        state.games = [];
        state.bookcases = [makeBookcase("Scratch", 1, { width: 10, height: 10, depth: 10 })];
        importWorkbook(XLSX.read(bytes));
        check("defaults survive export -> xlsx -> import", snapshot() === defaults, message());
        check("20 games, 6 shelves, 3 shelved after import",
            state.games.length === 20 && state.bookcases[0].shelves.length === 6 && state.games.filter(function (g) { return g.placement; }).length === 3);

        // ---- 2. Round trip of a richer 3D layout
        loadTwenty();
        state.view3d = true;

        // Two columns of two shelves; the games below go in the right-hand column's bottom shelf
        const second = makeBookcase("", 2, { width: 50, height: 20, depth: 15 }, 2);
        second.shelves[0].name = "Card games";
        second.shelves[2].name = "Card games";
        second.shelves[1].allowOverhang = false;
        second.shelves[3].allowOverhang = false;

        // One shelf locked in one column only, and one tall-BILLY shelf locked outright
        second.shelves[3].locked = true;
        state.bookcases[0].shelves[2].locked = true;
        second.maxOverhang = 4.5;
        state.bookcases.push(second);

        const duel = state.games.find(function (g) { return g.name === "7 Wonders Duel"; });
        duel.height = 5.1;
        duel.width = 20.3;
        duel.depth = 5;
        duel.placement = { shelfId: second.shelves[3].id, x: 3.25, y: 0, z: 0 };

        const lotr = state.games.find(function (g) { return g.name === "Twilight Struggle"; });
        lotr.height = 4.8;
        lotr.width = 20;
        lotr.depth = 6;
        lotr.placement = { shelfId: second.shelves[3].id, x: 3.25, y: 0, z: 7.5 };
        lotr.locked = true;

        state.games.push(makeGame("", 9, 3, 6));
        state.games.push(makeGame("Café \"Quotes\", commas", 14, 3.5, 10));
        render();

        const rich = snapshot();
        exportWorkbook();
        bytes = XLSX.write(captured, { type: "array", bookType: "xlsx" });

        const gamesSheet = XLSX.utils.sheet_to_json(captured.Sheets.Games, { header: 1 });
        const shelvesSheet = XLSX.utils.sheet_to_json(captured.Sheets.Shelves, { header: 1 });
        check("Games header row", gamesSheet[0].join("|") === "Name|Width|Height|Depth|This Side Up|Lock In Place|Bookcase|Column|Shelf|X|Y|Z", gamesSheet[0].join("|"));
        check("Shelves header row", shelvesSheet[0].join("|") === "Bookcase|Bookcase Name|Columns|Width|Depth|Max Overhang|Shelf Name|Height|Allow Overhang|Locked", shelvesSheet[0].join("|"));
        const exportedNames = gamesSheet.slice(1).map(function (row) { return row[0] === undefined ? "" : String(row[0]); });
        check("games are exported in alphabetical order, with the unnamed one last",
            exportedNames[0] === "7 Wonders Duel" && exportedNames[exportedNames.length - 1] === "" &&
            exportedNames.slice(0, -1).every(function (name, i) { return i === 0 || compareByName({ name: exportedNames[i - 1] }, { name: name }) <= 0; }),
            exportedNames.slice(0, 4).join(", ") + " ... " + JSON.stringify(exportedNames[exportedNames.length - 1]));
        const lotrRow = gamesSheet.find(function (row) { return row[0] === "Twilight Struggle"; });
        check("a game in the second column is exported with Bookcase 2, Column 2, Shelf 2",
            lotrRow[6] === 2 && lotrRow[7] === 2 && lotrRow[8] === 2, JSON.stringify(lotrRow.slice(6, 9)));
        check("one row per game and per shelf row (columns don't repeat rows)", gamesSheet.length === 23 && shelvesSheet.length === 9, gamesSheet.length + " / " + shelvesSheet.length);

        loadTwenty();
        render();
        importWorkbook(XLSX.read(bytes));
        check("3D layout survives the round trip (two bookcases, depth, locks, blank and awkward names)", snapshot() === rich, message());
        check("import keeps boxes that sit in front of others, whichever view is showing",
            state.games.some(function (g) { return g.placement && g.placement.z > 0; }));

        // ---- 3. Games-only CSV, hand written
        loadTwenty();
        render();

        const before = JSON.parse(snapshot()).bookcases;
        importWorkbook(XLSX.read("name, HEIGHT ,Width,Depth\nFoo,5,20,20\n,3,10,10\nBroken,,1,1\nAlso broken,abc,1,1\n", { type: "string" }));
        check("games CSV: 2 valid games imported, bad rows skipped", state.games.length === 2 && state.games[0].name === "Foo" && state.games[1].name === "", state.games.length + " games");
        check("games CSV: message reports 2 skipped rows", message().indexOf("skipped 2") >= 0, message());
        check("games CSV: bookcases left alone", JSON.stringify(JSON.parse(snapshot()).bookcases) === JSON.stringify(before));
        check("games CSV: nothing shelved", state.games.every(function (g) { return !g.placement; }));

        // ---- 4. Shelves-only CSV
        loadTwenty();
        render();
        importWorkbook(XLSX.read("Bookcase,Bookcase Name,Shelf Name,Height,Width,Depth,Allow Overhang\n1,Left,,30,80,30,TRUE\n1,Left,Low,30,80,30,no\n2,Right,,40,40,40,\n", { type: "string" }));
        check("shelves CSV in the old one-row-per-shelf layout still gives single-column bookcases",
            state.bookcases.every(function (b) { return b.columns === 1; }));
        check("shelves CSV: two bookcases of 2 and 1 shelves",
            state.bookcases.length === 2 && state.bookcases[0].shelves.length === 2 && state.bookcases[1].shelves.length === 1 && state.bookcases[1].name === "Right");
        check("shelves CSV: overhang TRUE / no / blank -> true / false / true",
            state.bookcases[0].shelves[0].allowOverhang === true && state.bookcases[0].shelves[1].allowOverhang === false && state.bookcases[1].shelves[0].allowOverhang === true);
        check("shelves CSV: games kept but all unshelved (their shelves are gone)",
            state.games.length === 20 && state.games.every(function (g) { return !g.placement && !g.locked; }), message());

        // ---- 4b. Shelves in the new layout, with columns, and a game placed by column
        loadTwenty();
        render();
        importWorkbook(XLSX.read(
            "Bookcase,Bookcase Name,Columns,Width,Depth,Max Overhang,Shelf Name,Height,Allow Overhang\n" +
            "1,Cube,3,33,38,5,,33,TRUE\n" +
            "1,,,,,,Low,40,FALSE\n", { type: "string" }));
        check("columns CSV: one bookcase of 3 columns x 2 shelves, sized from its first row",
            state.bookcases.length === 1 && state.bookcases[0].columns === 3 && state.bookcases[0].shelves.length === 6 &&
            state.bookcases[0].maxOverhang === 5 &&
            state.bookcases[0].shelves.every(function (s) { return s.width === 33 && s.depth === 38; }) &&
            state.bookcases[0].shelves.map(function (s) { return s.height; }).join(",") === "33,40,33,40,33,40" &&
            state.bookcases[0].shelves[3].name === "Low" && state.bookcases[0].shelves[3].allowOverhang === false,
            JSON.stringify(state.bookcases[0].shelves.map(function (s) { return [s.width, s.height, s.depth]; })));

        importWorkbook(XLSX.read(
            "Name,Width,Height,Depth,Bookcase,Column,Shelf,X,Y\n" +
            "In column three,10,10,10,1,3,2,0,0\n" +
            "No such column,10,10,10,1,4,1,0,0\n", { type: "string" }));
        check("columns CSV: a game's Column and Shelf pick the right compartment, and a missing column leaves it unsorted",
            state.games[0].placement && state.games[0].placement.shelfId === state.bookcases[0].shelves[5].id && !state.games[1].placement);

        // ---- 5. Bad placements and the old column name
        loadTwenty();
        render();
        importWorkbook(XLSX.read(
            "Name,Height,Width,Depth,Lock Rotation,Lock In Place,Bookcase,Shelf,X,Y\n" +
            "A,10,20,20,yes,yes,1,1,0,0\n" +
            "B,10,20,20,,,1,1,5,0\n" +
            "C,10,20,20,,,1,1,30,12\n" +
            "D,40,20,20,,,1,2,0,0\n" +
            "E,10,20,20,,,9,9,0,0\n", { type: "string" }));

        const byName = {};
        state.games.forEach(function (g) { byName[g.name] = g; });
        check("placement: A shelved, locked, this-side-up via old 'Lock Rotation' header",
            Boolean(byName.A.placement) && byName.A.locked && byName.A.rotationLocked);
        check("placement: B overlapping A goes to unsorted", !byName.B.placement);
        check("placement: C floating at y=12 drops to the shelf floor", byName.C.placement && byName.C.placement.y === 0, JSON.stringify(byName.C.placement));
        check("placement: D taller than its shelf goes to unsorted", !byName.D.placement);
        check("placement: E on a shelf that doesn't exist stays unsorted", !byName.E.placement);
        check("placement: message reports 2 that didn't fit", message().indexOf("2 game(s)") >= 0, message());

        // ---- 6. A file with nothing usable
        const untouched = snapshot();
        importWorkbook(XLSX.read("Foo,Bar\n1,2\n", { type: "string" }));
        check("unusable file: state untouched and failure reported", snapshot() === untouched && message().indexOf("Import failed") === 0, message());

        // ---- 7. Persistence picks up an import
        const saved = JSON.parse(localStorage.getItem("gameSorter.state"));
        check("imported state is what was saved to the browser", saved.games.length === state.games.length);
    }
    catch (error)
    {
        failures++;
        out.push("ERROR " + error.message + "\n" + error.stack);
    }

    out.push(failures === 0 ? "ALL PASSED" : failures + " FAILED");
    document.body.innerHTML = "<pre id='testout'>" + out.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>";
});
