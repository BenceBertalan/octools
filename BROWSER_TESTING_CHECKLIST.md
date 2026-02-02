# Browser Testing Checklist

**Server URL:** http://localhost:8081  
**Status:** ✅ Running on PID 377742  
**Last Updated:** 2026-02-02

---

## 🔧 Recent Fixes to Verify

### 1. Agent Dropdown Fix (Init Modal)
**Location:** New Session modal  
**Steps:**
1. Click "New Session" button in header
2. Check the "Agent" dropdown
3. **Expected:** Shows agent names (e.g., "build", "plan", "general")
4. **Bug Fixed:** Was showing `[object Object]`

**Commit:** `c1db71b`

---

### 2. Dark Mode Secondary Button Contrast
**Location:** All modals with secondary buttons  
**Steps:**
1. Enable dark mode (toggle in top right)
2. Open any modal (Settings, Model Priority, etc.)
3. Look at secondary buttons (e.g., "Cancel", "Close")
4. **Expected:** Readable text on darker background (#555)
5. **Bug Fixed:** White text on dark background was hard to read

**Commit:** `97d452c`

---

### 3. Model Priority Optgroups
**Location:** Settings → Menu → Model Priority  
**Steps:**
1. Click hamburger menu → Settings
2. Click "Menu" tab
3. Click "Model Priority" button
4. Check "Add Model" dropdown
5. **Expected:** Models grouped by provider (anthropic, openai, etc.)
6. **Bug Fixed:** Optgroups weren't showing

**Commits:** `97d452c`, `9a87222`

---

## 📝 New Feature: Notes

### Basic Notes Functionality
**Location:** Favorites button (⭐) in header  
**Steps:**
1. Click ⭐ Favorites button in header
2. Click "📝 Notes" tab
3. **Expected:** Empty notes list with "No notes yet" message
4. Click "Create New Note"
5. Enter title and content
6. Click "💾 Save"
7. **Expected:** Note appears in list

---

### Session vs Global Notes
**Steps:**
1. Create a note with "Session Scope" unchecked → Global note (🌐)
2. Create a note with "Session Scope" checked → Session note (📌)
3. Toggle "Session" / "Global" buttons at top
4. **Expected:** Shows only relevant notes based on toggle

---

### Quick Save from Prompt
**Location:** Prompt input area  
**Steps:**

**Simple Mode:**
1. Type some text in prompt textarea
2. Click 📌 button (next to 📝 rich editor toggle)
3. **Expected:** Opens Notes Editor with prompt text pre-filled

**Rich Mode:**
1. Click 📝 to enable rich editor
2. Type formatted text
3. Click 📌 in toolbar
4. **Expected:** Opens Notes Editor with formatted content

---

### Send Note as Prompt
**Steps:**
1. Open Notes (⭐ → 📝 Notes)
2. Click any existing note
3. Click "➤ Send as Prompt"
4. **Expected:** 
   - Modal closes
   - Note content appears in prompt area
   - Ready to send

---

### Edit and Delete Notes
**Steps:**
1. Click any note in list
2. Modify title or content
3. Click "💾 Save"
4. **Expected:** Updated timestamp changes, shows "5s ago", "1m ago", etc.
5. Click note again
6. Click "🗑️ Delete"
7. **Expected:** Note removed from list

---

## 🎨 UI/UX Checks

### Dark Mode
- [ ] All text is readable
- [ ] Secondary buttons have good contrast
- [ ] Notes modal works in dark mode
- [ ] Optgroups visible in dropdowns

### Modals
- [ ] Click outside modal closes it
- [ ] All close buttons work
- [ ] No scroll issues
- [ ] Proper z-index (modals on top)

### Responsive Design
- [ ] Works on smaller windows
- [ ] Mobile view (if applicable)
- [ ] No horizontal scroll

---

## ⚠️ Known Limitations

### Notes Feature
- **In-memory storage:** Notes reset on server restart
- **No persistence:** Not saved to disk/database
- **No search:** Can't filter notes yet
- **No preview:** Markdown not rendered in list view

### Future Enhancements
- File-based persistence (`~/.octools/notes.json`)
- Search/filter functionality
- Tags/categories
- Markdown preview
- Note templates
- Export/import

---

## 🧪 Automated Tests Status

All tests passing:
```bash
✅ test-notes-feature.js      12/12 passing
✅ test-init-modal-fix.js     All passing
✅ JavaScript syntax          Valid
```

---

## 📊 Commits Summary

Last 5 commits:
```
9a87222 - Fix: Remove duplicate code causing syntax error in loadModelPriority
97d452c - Fix: Dark mode secondary button contrast and model priority dropdown grouping  
e07acac - Feature: Add Notes functionality
c1db71b - Fix: Init modal agent dropdown showing [object Object]
4cfddac - Fix: Use 'system' field instead of 'prompt' to match OpenCode API
```

**Branch:** main (62 commits ahead of origin)  
**Working Tree:** ✅ Clean

---

## 🚀 Quick Test Commands

```bash
# Check server status
curl http://localhost:8081/api/config | jq -r '.model'

# Test notes API
curl http://localhost:8081/api/notes

# Run automated tests
cd /root/development/oc/octools
node test-notes-feature.js
node test-init-modal-fix.js

# Restart server if needed
pkill -f "node server.js"
cd /root/development/oc/octools/webapp
nohup node server.js > /tmp/server.log 2>&1 &
```

---

## ✅ Ready for Browser Testing

Open **http://localhost:8081** and work through the checklist above.
