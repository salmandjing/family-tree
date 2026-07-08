# Browser-Extension Re-Test Prompt — Family Tree (regression + freeze profiling)

Paste the box below into a Claude Code session with the **browser extension** active.

---

You are a QA engineer re-testing the **Family Tree** app after a round of fixes. Two
goals: (1) confirm the fixes landed, and (2) if the previously-reported freeze
recurs, **capture a real Performance profile** so we can diagnose it — this time we
need data, not just "it froze."

## Target & credentials
- URL: **https://djsalman.dev/tree**  ·  Password: **`<the family password — ask Salman>`**
- Static SPA; data lives in the browser (IndexedDB) and backs up to Google Drive.

## ⚠️ Safety (LIVE app, real Drive)
1. After unlocking, check if real family data already exists. If yes → **STOP, click
   Download to save it, report, and await instructions.** If it's the empty "Start your
   family tree" screen → proceed.
2. Editing backs up to Drive. **Keep a list of every test person/photo you create.**
3. Use only obvious test names.

## Priority 1 — Verify the fixes (record PASS/FAIL + screenshot each)
1. **Auto-fit on load:** reload the page with several people present. The whole family
   should be centered and zoomed to fit — NOT sitting off to one side with cards cut
   off. Check at desktop AND phone (390×844) sizes.
2. **Relationship lines:** the connecting lines between people should be clearly visible
   (a medium-dark gray-green), not barely-there light gray.
3. **Bigger checkboxes:** the birth/death **"Approximate"** and **"Deceased"** checkboxes
   should be comfortably tappable (~24px) with a large tap row.
4. **"Working…" feedback:** perform **Restore a version** (History), **Delete forever**
   (Recently deleted), and **Upload** a JSON — each should briefly show a centered
   **"Working…" spinner overlay** while it runs. Confirm the overlay appears and then
   clears, and the result is correct.

## Priority 2 — Re-attempt the freeze, WITH profiling
Previously, **Delete-forever** and **Restore-an-earlier-version** appeared to freeze the
app for minutes. Try hard to reproduce:

1. Build a sizable tree first (this matters): add ~40–60 people via +Parent/+Spouse/+Child
   across a few generations, including a couple with two spouses and several children.
   (Or, if you have a large family-tree JSON, use **Upload**.)
2. Add **2–3 photos** to some people (the prior session had photos).
3. Now: open **History → Restore** an earlier version. Then send someone to **Recently
   deleted → Delete forever**.

**If the app becomes unresponsive at any point:**
- **Immediately start a DevTools → Performance recording** (or CPU profile), let it run
  for ~10–20 seconds while frozen, stop it, and **save/attach the profile**. Note which
  function/call is consuming the main thread (the flame chart's widest bars).
- Also capture: exact wall-clock time it was unresponsive; the exact button clicked;
  how many people were in the tree; whether photos were involved; the browser console
  (any errors); and your best read on whether **your own automation harness** was
  saturated at that moment (e.g. were screenshots/evals also slow app-wide?).

**If it does NOT freeze:** record the wall-clock time each operation took (they should be
well under a second) and note the tree size you tested at.

## Priority 3 — Quick regression of core flows
- Add a person; type a long name fast → no dropped/reordered characters.
- +Spouse, +Child; polygamy "which partner?" prompt appears with two spouses.
- **"⤢ Whole tree"** button closes the card and zooms to the full tree.
- XSS: set a name to `<img src=x onerror="alert(1)">` → must NOT execute; literal text shows.
- Download a JSON; in a fresh incognito window, unlock + Upload it → tree restored intact.
- Undo/Redo; Delete → Recently deleted → Restore.

## Report
Per finding: what you did, expected vs actual, console text, screenshot; rank
**Critical / High / Medium / Low**. For any freeze: **attach the Performance profile** and
the diagnostics above. End with **the full list of test people/photos you created** so
they can be cleaned from Drive. Do not fix anything — report only.
