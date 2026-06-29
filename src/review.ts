import { join } from "@std/path";
import {
  type Component,
  Editor,
  type EditorTheme,
  KeybindingsManager,
  Markdown,
  type MarkdownTheme,
  matchesKey,
  ProcessTerminal,
  type SelectListTheme,
  setKeybindings,
  TUI,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { expandHome, loadConfig } from "./config.ts";
import {
  commitTicket,
  readPhaseOutput,
  readTicket,
  writePhaseOutput,
  writeTicket,
} from "./state/store.ts";
import { PHASE_OUTPUT_FILE, PHASE_SEQUENCE } from "./phases/types.ts";

const markdownTheme: MarkdownTheme = {
  heading: (s) => s,
  link: (s) => s,
  linkUrl: (s) => s,
  code: (s) => s,
  codeBlock: (s) => s,
  codeBlockBorder: (s) => s,
  quote: (s) => s,
  quoteBorder: (s) => s,
  hr: (s) => s,
  listBullet: (s) => s,
  bold: (s) => s,
  italic: (s) => s,
  strikethrough: (s) => s,
  underline: (s) => s,
};

const selectListTheme: SelectListTheme = {
  selectedPrefix: (s) => s,
  selectedText: (s) => s,
  description: (s) => s,
  scrollInfo: (s) => s,
  noMatch: (s) => s,
};

const editorTheme: EditorTheme = {
  borderColor: (s) => s,
  selectList: selectListTheme,
};

export async function findLatestPhaseOutput(
  ticketDir: string,
): Promise<{ filename: string; phaseName: string } | null> {
  for (const phase of [...PHASE_SEQUENCE].reverse()) {
    const revisionFiles: string[] = [];
    try {
      for await (const entry of Deno.readDir(ticketDir)) {
        if (
          entry.isFile &&
          entry.name.startsWith(`${phase}-`) &&
          entry.name.endsWith(".md") &&
          !entry.name.includes("-feedback-")
        ) {
          revisionFiles.push(entry.name);
        }
      }
    } catch { /* dir missing */ }
    if (revisionFiles.length > 0) {
      revisionFiles.sort();
      return {
        filename: revisionFiles[revisionFiles.length - 1],
        phaseName: phase,
      };
    }
    const canonicalFile = PHASE_OUTPUT_FILE[phase];
    try {
      await Deno.stat(join(ticketDir, canonicalFile));
      return { filename: canonicalFile, phaseName: phase };
    } catch { /* not found */ }
  }
  return null;
}

function formatTimestamp(now: Date): string {
  const iso = now.toISOString();
  return (
    iso.slice(0, 10) +
    "T" +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19)
  );
}

class ContentPane implements Component {
  private md: Markdown;
  private scrollOffset = 0;
  private tui: TUI;

  constructor(content: string, tui: TUI) {
    this.md = new Markdown(content, 1, 0, markdownTheme);
    this.tui = tui;
  }

  private editorHeight(): number {
    return Math.max(5, Math.floor(this.tui.terminal.rows * 0.3)) + 2;
  }

  private availableHeight(): number {
    return Math.max(1, this.tui.terminal.rows - this.editorHeight());
  }

  handleInput(data: string): void {
    if (matchesKey(data, "space")) {
      const height = this.availableHeight();
      const allLines = this.md.render(this.tui.terminal.columns);
      const maxOffset = Math.max(0, allLines.length - height);
      this.scrollOffset = Math.min(this.scrollOffset + height, maxOffset);
    }
  }

  invalidate(): void {
    this.md.invalidate();
  }

  render(width: number): string[] {
    const allLines = this.md.render(width);
    const height = this.availableHeight();
    return allLines.slice(this.scrollOffset, this.scrollOffset + height);
  }
}

export async function review(id: string): Promise<void> {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ticketDir = join(stateDir, id);

  await readTicket(stateDir, id);

  const found = await findLatestPhaseOutput(ticketDir);
  if (!found) {
    console.error(`No phase output found for ${id}`);
    Deno.exit(1);
  }

  const content = await readPhaseOutput(stateDir, id, found.filename);

  const kb = new KeybindingsManager({
    ...TUI_KEYBINDINGS,
    "tui.input.submit": {
      defaultKeys: ["shift+enter"],
      description: "Submit input",
    },
    "tui.input.newLine": {
      defaultKeys: ["enter", "ctrl+j"],
      description: "Insert newline",
    },
  });
  setKeybindings(kb);

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const contentPane = new ContentPane(content, tui);
  const editor = new Editor(tui, editorTheme);

  tui.addChild(contentPane);
  tui.addChild(editor);
  tui.setFocus(contentPane);

  let focused: "content" | "editor" = "content";

  async function handleSubmit(text: string): Promise<void> {
    if (!text.trim()) return;
    const now = new Date();
    const timestamp = formatTimestamp(now);
    const feedbackFile = `${found!.phaseName}-feedback-${timestamp}.md`;
    await writePhaseOutput(stateDir, id, feedbackFile, text);
    const updated = await readTicket(stateDir, id);
    const revisingPhase = `revising-${
      found!.phaseName
    }` as typeof updated.phase;
    await writeTicket(stateDir, {
      ...updated,
      phase: revisingPhase,
      updated: now.toISOString(),
    });
    await commitTicket(stateDir, id, `review: ${id}`);
    tui.stop();
    Deno.exit(0);
  }

  editor.onSubmit = handleSubmit;

  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+c")) {
      tui.stop();
      Deno.exit(0);
    }
    if (matchesKey(data, "tab")) {
      if (focused === "content") {
        focused = "editor";
        tui.setFocus(editor);
      } else {
        focused = "content";
        tui.setFocus(contentPane);
      }
      return { consume: true };
    }
    if (matchesKey(data, "shift+enter") && focused === "content") {
      const text = editor.getText();
      if (text.trim()) {
        handleSubmit(text);
      }
      return { consume: true };
    }
  });

  tui.start();
}
