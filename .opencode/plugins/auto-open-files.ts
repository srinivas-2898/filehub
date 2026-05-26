import type { Plugin } from "@opencode-ai/plugin"
import path from "path"

export const AutoOpenFilesPlugin: Plugin = async ({ $, client, worktree }) => {
  // Determine which editor command to use
  const getEditorCommand = async (): Promise<string | null> => {
    const editorCandidates = ["cursor", "code", "windsurf", "codium"]

    for (const editor of editorCandidates) {
      try {
        await $`${editor} --version`
        await client.app.log({
          body: {
            service: "auto-open-files",
            level: "info",
            message: `Auto-open files plugin detected editor: ${editor}`,
          },
        })
        return editor
      } catch {
        // Continue to next editor
      }
    }

    return null
  }

  let editorCommand: string | null = null

  return {
    "tool.execute.after": async (input, output) => {
      // Get editor command on first run
      if (!editorCommand) {
        editorCommand = await getEditorCommand()
        if (!editorCommand) {
          await client.app.log({
            body: {
              service: "auto-open-files",
              level: "warn",
              message:
                "No supported IDE found (cursor/code/windsurf/codium). Install Cursor or VS Code for auto-open functionality.",
            },
          })
          return
        }
      }

      // Handle file writes and edits
      if (input.tool === "write" || input.tool === "edit") {
        const filePath = output.args?.filePath
        if (filePath) {
          try {
            // Convert to absolute path if needed
            const absolutePath = path.isAbsolute(filePath)
              ? filePath
              : path.join(worktree, filePath)

            // Open file with --goto flag (line 1) to ensure reveal in explorer
            // and --reuse-window to use existing editor window
            await $`${editorCommand} --reuse-window --goto "${absolutePath}:1"`

            await client.app.log({
              body: {
                service: "auto-open-files",
                level: "debug",
                message: `Opened file in ${editorCommand}: ${absolutePath}`,
              },
            })
          } catch (error) {
            await client.app.log({
              body: {
                service: "auto-open-files",
                level: "debug",
                message: `Could not open ${filePath} in ${editorCommand}`,
              },
            })
          }
        }
      }

      // Handle apply_patch - open all modified files
      if (input.tool === "apply_patch") {
        const patchText = output.args?.patchText
        if (patchText) {
          try {
            // Extract file paths from patch markers
            const fileMatches = patchText.match(
              /\*\*\* (?:Add File|Update File|Move to): (.+?)(?:\n|$)/g
            )
            if (fileMatches && fileMatches.length > 0) {
              const filesOpened: string[] = []

              for (const match of fileMatches) {
                const filePath = match
                  .replace(/\*\*\* (?:Add File|Update File|Move to): /, "")
                  .trim()
                try {
                  // Convert to absolute path if needed
                  const absolutePath = path.isAbsolute(filePath)
                    ? filePath
                    : path.join(worktree, filePath)

                  // Open each modified file with --goto to reveal in explorer
                  await $`${editorCommand} --reuse-window --goto "${absolutePath}:1"`
                  filesOpened.push(filePath)
                } catch (err) {
                  // Continue to next file
                }
              }

              if (filesOpened.length > 0) {
                await client.app.log({
                  body: {
                    service: "auto-open-files",
                    level: "info",
                    message: `Opened ${filesOpened.length} files in ${editorCommand}`,
                    extra: { files: filesOpened },
                  },
                })
              }
            }
          } catch (error) {
            await client.app.log({
              body: {
                service: "auto-open-files",
                level: "debug",
                message: "Error processing patch files",
              },
            })
          }
        }
      }
    },
  }
}
