# Independent QA Prompt — Family Tree (local environment)

Copy everything in the box below into another AI agent (one that can run a shell
and drive a browser) or hand it to a human tester.

---

You are an independent QA engineer. Your job is to test a locally-running web app
called **Family Tree** with fresh eyes and **no trust in the developer's claims**.
Find bugs, confusing behavior, and data-loss risks. Be adversarial but fair.

## About the app (context, not gospel — verify everything)

A static React SPA for a non-technical user to record a large family's ancestry.
Core promises to test hard:
1. **Effortless** on desktop, tablet, and phone (touch targets, clarity).
2. **Data is never lost silently** — autosave, 20-version history, a 30-day
   "recently deleted" bin, undo/redo, and one-click JSON export/import.
It models a **graph** (not a binary tree): polygamy, remarriage, and adopted/step
/half relationships are expected to work. Dates may be **approximate** ("around
1950"). Backup-to-cloud is optional and is NOT configured locally, so the status
bar should read "Saved on this device" and there should be no login screen.

## Setup

```bash
# from the project root
npm install
npm run dev
```

Open the URL Vite prints. **Important:** the app is served under a base path —
use `http://localhost:5173/tree/` (with the trailing `/tree/`), NOT the bare host.
Also run the automated suite and record the result:

```bash
npm test
npm run build     # must succeed
```

## Test plan — execute each and record PASS/FAIL with a note

### A. First run & basic add
1. Load the app. Expect an empty state with "Start your family tree". No console errors.
2. Click **Add the first person**. A person card should slide in for an unnamed person.
3. Type a Given name; the card title should update live as you type.
4. Reload the browser. The person must still be there (persistence).

### B. Relationships (the graph)
5. On a person, use **+ Parent**, **+ Spouse**, **+ Child**. Each opens a new
   editable person and the tree redraws.
6. **Polygamy:** give one man two spouses (two **+ Spouse** on the same person).
   Then click **+ Child** on him — it must ASK which partner the child belongs to.
7. Add children to each spouse. Confirm half-siblings are grouped under the correct
   parents (children of different unions are not shown as full siblings).
8. Click cards in the tree to open them. Clicking an *empty gap / placeholder* area
   must NOT open a broken "this person no longer exists" card. (This was a bug —
   verify it's gone.)
9. Add a parent, then a second parent to the same child — they should share one
   parent union, not create duplicates.

### C. Person details
10. Set an **approximate** birth year (toggle "Approximate", enter "1950"). The tree
    label should show something like "~1950".
11. Mark someone **Deceased** and add a death year/place. Toggle it back off.
12. Add **nicknames** (comma-separated) and a long **Stories/Notes** entry. Reload;
    all fields must persist exactly.
13. Enter **non-Latin / emoji** names (e.g. "José 👨🏾", "N'Diaye ﷽"). They must
    save and reload intact.

### D. Photos
14. **+ Photo** on a person; pick an image. It should appear on the card and as the
    tree avatar. Add a second photo. Confirm the first is the primary/face photo.
15. Reload — photos persist. Check the downloaded export still contains them (§F).

### E. Redundancy & recovery (the headline)
16. Make several edits, then use **Undo** / **Redo** repeatedly. Data should walk
    back and forward correctly; the version number should keep going UP, never down.
17. **Delete** a person → they go to **Recently deleted**, not gone. Restore them.
18. In **Recently deleted**, try **Delete forever** on someone; confirm they're gone
    and their photo is cleaned up.
19. Open **History**. Restore an earlier version. Your current version should remain
    in history (nothing lost). Confirm the restore can itself be undone.

### F. Export / Import (portability)
20. Click **Download** — a `family-tree-YYYY-MM-DD.json` file downloads.
21. Open a **private/incognito** window at the same `/tree/` URL (fresh storage).
    It should show the empty state. Click **Upload** and select the file. The whole
    family — people, links, photos — must reappear intact.
22. Corrupt the JSON (delete a brace) and try to Upload it. Expect a clear, friendly
    error, and the existing tree must be untouched.

### G. Touch / responsive
23. Open dev tools device emulation (or a real phone at the Network URL Vite prints).
    Test iPhone-size and iPad-size. All buttons should be easily tappable (~44px+),
    the person card should be usable, and nothing should overflow horizontally.

### H. Stress / adversarial
24. Add ~30–50 people quickly. The app should stay responsive; search should still
    jump to a typed name and center the tree.
25. Rapidly click Undo/Redo and Add — look for lost updates, duplicate people, or
    console errors.
26. Delete a person who is a shared parent of several children; verify the children
    and the other parent survive and the tree still renders.

## What to report

For each failing step: the step number, exact repro clicks, what you expected, what
happened, any console error text, and a screenshot if visual. Also report:
- Anything a non-technical 70-year-old would find confusing or scary.
- Any moment where you feared data might have been lost.
- The result of `npm test` and `npm run build`.

Rank findings: **Critical** (data loss / crash), **High** (feature broken),
**Medium** (confusing UX), **Low** (polish). Do not fix anything — just report.
