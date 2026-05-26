# Auto-Open Files Plugin Setup

This directory contains the OpenCode auto-open files plugin configuration.

## What It Does

When OpenCode creates or modifies files, it automatically:
1. Opens the file in your IDE editor
2. Reveals it in the file explorer
3. Focuses the editor window

## Supported IDEs

- **Cursor** (Primary)
- VS Code
- Windsurf
- VSCodium

## Installation & Setup

### 1. Cursor Setup (Recommended)

Ensure Cursor is installed and accessible from terminal:

```bash
# Verify Cursor is in PATH
cursor --version
```

If `cursor` command is not found, add Cursor to PATH:

- **macOS**: Cursor → Shell Commands → Install 'cursor' command in PATH
- **Windows**: Cursor → Command Palette → Shell Commands → Install 'cursor' command in PATH
- **Linux**: Install from package manager or add manually to PATH

### 2. Verify Plugin Installation

The plugin file is located at:
```
.opencode/plugins/auto-open-files.ts
```

It's automatically loaded when OpenCode starts.

### 3. Test the Setup

1. Start OpenCode in your project:
```bash
opencode
```

2. Ask it to create a file:
```
Create a new file called test.txt with some content
```

3. The file should automatically:
   - Open in your editor
   - Appear in the file explorer
   - Be focused for editing

### 4. Verify Logs (Optional)

To see plugin logs, check the OpenCode logs while it's running. The plugin uses `client.app.log()` which will show:
- Which editor was detected
- Which files were opened
- Any errors encountered

## Configuration

### Editor Priority

The plugin detects editors in this order:
1. **Cursor** (if installed)
2. VS Code
3. Windsurf
4. VSCodium

The first detected editor is used.

### IDE-Specific Settings

VS Code/Cursor settings are configured in `.vscode/settings.json`:

```json
{
  "explorer.autoReveal": true,
  "editor.revealInExplorer": true
}
```

These ensure files are revealed in the explorer when opened.

## Troubleshooting

### Files not opening in editor

1. Check that your IDE command is in PATH:
```bash
cursor --version  # for Cursor
code --version    # for VS Code
```

2. Look for logs from the plugin during execution

3. Verify `.vscode/settings.json` exists and has auto-reveal enabled

### IDE command not found

**Cursor:**
- macOS/Windows: Use Command Palette → Shell Commands → Install command
- Linux: Install via package manager or manual PATH setup

**VS Code:**
- macOS: `code --version` to verify installation
- Windows: Should be in PATH after installation
- Linux: `sudo apt install code` or equivalent

### Plugin not loading

1. Ensure `.opencode/plugins/auto-open-files.ts` exists
2. Restart OpenCode (`exit` then `opencode`)
3. Check for TypeScript compilation errors

## Usage with Antigravity Provider

The plugin works with any OpenCode provider, including Antigravity. Configuration in `opencode.json`:

```json
{
  "provider": {
    "antigravity": {
      "models": { ... }
    }
  }
}
```

The auto-open plugin is provider-agnostic and will work automatically.

## Advanced: Custom IDE Integration

To add support for another IDE, edit `.opencode/plugins/auto-open-files.ts` and add to the `editorCandidates` array:

```typescript
const editorCandidates = ["cursor", "code", "windsurf", "codium", "my-editor"]
```

Then restart OpenCode.
