# Exhaustive Browser-Extension QA Prompt — Family Tree

Paste everything in the box below into a Claude Code session that has the **browser
extension** active (so it can navigate, click, type, screenshot, read the console,
resize the viewport, and throttle the network).

---

You are an exhaustive, adversarial QA engineer driving a real browser. Test the
**Family Tree** web app with fresh eyes and **no trust in prior claims**. Your goal:
find every bug, confusing behavior, data-loss risk, and rendering/interaction flaw.

## Target & credentials
- URL: **https://djsalman.dev/tree**
- Family password: **`<the family password — ask Salman>`**
- It's a static SPA: family data lives in the browser (IndexedDB) and is backed up to
  the owner's Google Drive through a Cloudflare Worker at `backup.djsalman.dev`.

## ⚠️ Safety rules (read first — this is a LIVE app that backs up to a real Drive)
1. **First, after unlocking, check whether the tree already contains real family data.**
   - If it has real people you didn't add → **STOP editing. Click "Download" to save a
     JSON backup, then report that real data exists and await instructions.** Do not
     delete or overwrite anything.
   - If it's empty (just the "Start your family tree" screen) → proceed freely.
2. Editing triggers a Drive backup (debounced ~2 min, and on tab close). Keep a running
   list of **every person/photo you create** so it can be cleaned up afterward.
3. Never enter real personal data about real people. Use obvious test names.

## How to test (use your browser tools fully)
- **Screenshot** at each major step and on every anomaly.
- **Watch the browser console** continuously; report any error/warning with its text.
- **Resize the viewport** to test responsive/touch: desktop (1280×800), tablet
  (iPad 768×1024), phone (iPhone 390×844). Check tap targets look ≥44px and that
  **nothing overflows horizontally**.
- Use **network throttling / offline** in devtools for the offline tests.

## Test plan — execute every item; record PASS/FAIL + notes + screenshot

### 1. Passphrase gate
- Wrong password → rejected with a clear message, no access.
- Correct password → unlocks.
- Reload the page → it should NOT ask for the password again (stored per device).
- Open a **private/incognito** window → it should ask for the password (fresh device).

### 2. First-run & basic person
- Empty state shows "Start your family tree".
- Add first person → the person card slides in; title reads "Unnamed person".
- Type a Given name → the card title updates **live and correctly** (type a long name
  quickly and confirm no characters are dropped or reordered).

### 3. All person fields (add, then reload, confirm each persisted exactly)
- Given, Family, Nicknames (comma-separated), Sex.
- Born: date, "Approximate" toggle, Place. Confirm the tree label shows `~` when approx.
- Deceased toggle → reveals death date/approx/place; toggle off hides them.
- Stories/Notes: paste a long multi-paragraph note.

### 4. Relationships (the graph)
- **+ Parent**, **+ Spouse**, **+ Child** each create an editable person and redraw the tree.
- Add a parent, then a **second parent** to the same child → they share ONE parent union
  (no duplicate). 
- **Polygamy:** give one person **two spouses**, then **+ Child** on that person → it must
  ask **"which partner?"** and list both spouses by name. Add children to each; confirm
  half-siblings group under the correct parents.
- Click cards in the tree to open them. Clicking empty space / a faint placeholder card
  must NOT open a broken "this person no longer exists" card.
- Use the relatives links inside a card to navigate between people.
- **Navigation:** after clicking into a person (tree centers on them), the floating
  **"⤢ Whole tree"** button (bottom-left of the tree) must close the card and zoom back
  out to show the entire tree. Verify it works from deep in the tree and on mobile sizes.

### 5. Search
- Type a name → matching people appear; selecting one centers/opens them.
- Search a non-existent name → no results, no error.
- Search with unicode/emoji.

### 6. Photos
- **+ Photo** → upload an image. It appears on the card and as the tree avatar.
- Add a second photo; confirm the first is the primary/face photo.
- Remove a photo. Reload → photo state persists.
- Upload a non-image file → clear, friendly error; app unaffected.
- Upload a very large image (e.g. >10 MB) → it should compress, not hang.

### 7. Redundancy & recovery (the headline requirement)
- Make several edits, then **Undo/Redo** repeatedly → data walks back/forward correctly;
  the version number only ever goes **up**.
- **History** → restore an earlier version; the current version must remain in history
  (nothing lost); confirm the restore can itself be undone.
- **Delete** a person → goes to **Recently deleted**, not gone. Restore them.
- In Recently deleted → **Delete forever** on a throwaway person; confirm gone + their
  photo cleaned up.

### 8. Backup status & sync (watch the bottom status bar)
- After an edit, the status should go amber ("Backing up…") then green ("✓ Backed up …").
  Force it by editing and closing/reopening the tab if the 2-min debounce is too slow.
- **Go offline** (devtools) and edit → status shows an offline/local message; data still
  saves locally. **Go back online** → it recovers (green) without losing edits.
- (Advanced, optional) Simulate a **conflict**: in a second incognito window, unlock and
  make a different edit; back in the first window, reload → a plain-language dialog should
  offer **Keep this device / Keep the other / Keep both**. Verify none silently overwrites.

### 9. Export / Import (portability)
- **Download** → a `family-tree-YYYY-MM-DD.json` file.
- In a fresh incognito window (unlock) → **Upload** that file → the whole tree (people,
  links, photos) reappears intact.
- Edit the file to be invalid (remove a brace) → Upload → clear friendly error, and the
  existing tree is untouched.

### 10. Security / XSS (try to break out — this MUST fail to execute)
- Set a person's **Given name** to each of these, one at a time, and confirm **no alert,
  no script execution, and the tree shows the literal text** (check the console too):
  - `<img src=x onerror="alert('xss')">`
  - `<script>alert(1)</script>`
  - `"><svg onload=alert(1)>`
  - `javascript:alert(1)`
- Put HTML/script text in **Notes** and **Nicknames** as well. Reload and re-render;
  still no execution.

### 11. Input edge cases
- Very long names (200+ chars). Emoji and non-Latin/RTL names (e.g. Arabic "محمد", "José 👨🏾").
- Empty name (save with only a nickname, or nothing). Whitespace-only fields.
- Rapidly click **+ Child / Undo / Add person** in bursts → look for duplicates, lost
  updates, or console errors.

### 12. Scale / performance
- Add ~30–50 people quickly (mix of parents/spouses/children). The app should stay
  responsive; search should still jump correctly; pan/zoom should be smooth.
- Delete a person who is a **shared parent** of several children → children and the other
  parent survive and the tree still renders.

### 13. Touch / responsive (repeat key flows at phone + tablet sizes)
- Person card usable; buttons tappable; tree pannable/zoomable; no horizontal scroll.

## What to report
For each finding: step number, exact repro, expected vs actual, console text, screenshot.
Rank: **Critical** (data loss/crash/XSS), **High** (feature broken), **Medium** (confusing
UX), **Low** (polish). Also explicitly call out:
- Anything a non-technical 70-year-old would find confusing or scary.
- Any moment you feared data could be lost.
- **The list of every test person/photo you created** (so it can be cleaned from Drive).

Do not fix anything — report only.
