# IDE Integration Setup - Complete

This document summarizes the auto-open files integration for OpenCode with Cursor, VS Code, and other IDEs.

## ✅ What Was Configured

### 1. **Auto-Open Plugin** (`.opencode/plugins/auto-open-files.ts`)
   - Automatically detects your IDE (Cursor, VS Code, Windsurf, VSCodium)
   - Prioritizes Cursor first
   - Opens files after creation or modification
   - Handles batch operations (patches)
   - Provides debug logging

### 2. **IDE Settings** (`.vscode/settings.json`)
   - `explorer.autoReveal`: true → Reveals opened files in explorer
   - `editor.revealInExplorer`: true → Shows file in explorer tree
   - Applies to both Cursor and VS Code

### 3. **Documentation** (`.opencode/README.md`)
   - Setup instructions
   - Troubleshooting guide
   - IDE detection priority
   - Custom integration examples

---

## 🚀 Quick Start

### Step 1: Verify Cursor is Installed
```bash
cursor --version
```

If this fails, install Cursor from: https://cursor.com

### Step 2: Add Cursor to PATH (if needed)

**macOS/Linux:**
```bash
# Cursor menu → Shell Commands → Install 'cursor' command in PATH
```

**Windows:**
```powershell
# Cursor Settings → Integrations → Shell Commands → Install 'cursor' command
```

### Step 3: Start OpenCode
```bash
cd C:\Users\gandu\fp
opencode
```

### Step 4: Test It
Ask OpenCode to create a file:
```
Create a new file named example.js with console.log("Hello, World!")
```

The file should automatically open in Cursor!

---

## 📁 Files Created/Modified

```
C:\Users\gandu\fp\
├── .opencode/
│   ├── README.md (Setup guide)
│   └── plugins/
│       └── auto-open-files.ts (Plugin)
├── .vscode/
│   └── settings.json (IDE settings)
└── opencode.json (Existing config - unchanged)
```

---

## 🎯 How It Works

1. **File Operation**: OpenCode creates or edits a file
2. **Plugin Hook**: `tool.execute.after` hook fires
3. **IDE Detection**: Plugin detects Cursor (or fallback IDE)
4. **File Opening**: Runs `cursor -- "filepath"`
5. **Auto Reveal**: VS Code/Cursor settings reveal file in explorer
6. **Result**: File opens and shows in explorer automatically

---

## 🔧 IDE Priority

The plugin checks for IDEs in this order:
1. **Cursor** ← Primary (you have this)
2. VS Code
3. Windsurf
4. VSCodium

Whichever is found first is used.

---

## 🌐 Works With Any Provider

This setup works with:
- ✅ Antigravity (your current provider)
- ✅ Anthropic
- ✅ OpenAI
- ✅ Any OpenCode-supported provider

---

## 🐛 Troubleshooting

### Issue: Files not opening
**Solution**: Check if `cursor --version` works in terminal. If not, add Cursor to PATH.

### Issue: Plugin not loading
**Solution**: Restart OpenCode completely (exit and run `opencode` again).

### Issue: File opens but doesn't show in explorer
**Solution**: Check `.vscode/settings.json` has `"explorer.autoReveal": true`

### Issue: Wrong IDE opening files
**Solution**: The plugin uses the first detected IDE. Uninstall or remove other IDEs from PATH to force Cursor priority.

---

## 📝 Next Steps

1. Run OpenCode: `opencode`
2. Test with: "Create a file called test.js"
3. Verify file opens in Cursor
4. Use normally - auto-open will work on all file operations

---

## 💡 Pro Tips

- The plugin works silently and logs to OpenCode debug output
- Files open instantly as they're created/edited
- Works with multi-file patches (via `apply_patch` tool)
- No configuration needed - it just works!

---

## 📞 Support

If issues occur:
1. Check `.opencode/README.md` for detailed troubleshooting
2. Verify `cursor --version` works
3. Restart OpenCode
4. Check OpenCode logs during execution
