# ⚡ Quick Checklist - Auto-Open Files Setup

## ✅ Installation Complete

- [x] Plugin created: `.opencode/plugins/auto-open-files.ts`
- [x] IDE settings created: `.vscode/settings.json`
- [x] Documentation created: `.opencode/README.md`
- [x] Setup guide created: `IDE_SETUP.md` (this folder)

## 📋 Before Using

- [ ] Verify Cursor is installed: `cursor --version`
- [ ] Verify Cursor is in PATH (should work from terminal)
- [ ] Restart terminal/OpenCode if Cursor was just installed

## 🧪 First Test

1. Open terminal in project folder
2. Run: `opencode`
3. In OpenCode, ask: "Create a test file called hello.js with console.log('hi')"
4. ✅ File should open in Cursor automatically

## 🎯 Expected Behavior

After this setup, whenever OpenCode:
- ✅ Creates a new file → Opens in Cursor
- ✅ Modifies a file → Opens in Cursor
- ✅ Applies patches → Opens all modified files in Cursor
- ✅ All files appear in Cursor explorer

## 🔧 Configuration Locations

| File | Purpose | Status |
|------|---------|--------|
| `.opencode/plugins/auto-open-files.ts` | Main plugin logic | ✅ Created |
| `.vscode/settings.json` | Cursor/VS Code settings | ✅ Created |
| `.opencode/README.md` | Technical docs | ✅ Created |
| `IDE_SETUP.md` | This setup guide | ✅ You're reading it |

## 📱 IDE Support

| IDE | Status | Command |
|-----|--------|---------|
| Cursor | ✅ Primary | `cursor --version` |
| VS Code | ✅ Fallback | `code --version` |
| Windsurf | ✅ Fallback | `windsurf --version` |
| VSCodium | ✅ Fallback | `codium --version` |

## 🆘 If It's Not Working

1. **Check Cursor command exists:**
   ```bash
   cursor --version
   ```

2. **Restart OpenCode:**
   ```bash
   exit
   opencode
   ```

3. **Check logs during OpenCode operation**
   - Plugin logs when file opens
   - Look for "auto-open-files" messages

4. **Verify settings file:**
   ```bash
   cat .vscode/settings.json
   ```
   Should show `"explorer.autoReveal": true`

## 📝 Integration with Antigravity

This setup works with your Antigravity provider configured in `opencode.json`. No additional configuration needed.

The plugin is provider-agnostic and works with:
- Antigravity models
- Any OpenCode provider
- Multiple concurrent sessions

## 🎉 You're All Set!

Start using OpenCode with auto-open files:

```bash
opencode
```

Files will now open automatically in Cursor as you work!
