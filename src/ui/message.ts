export interface StartupMessage {
  character: string;
  message: string;
}

const MESSAGES: StartupMessage[] = [
  {
    message: "Automagic development in progress!",
    character:
      "   ^__^\n   (oo)\\_______\n   (__)\\       )\\/\\\n       ||----w |\n       ||     ||",
  },
  {
    message: "Tickets flowing smoothly through the phases...",
    character: "   ___\n  <o o>\n  ( = )\n  / \\ \\\n (   )\n (     )",
  },
  {
    message: "Judging only the judgeable, automating the rest",
    character: "   /\\_/\\\n  / o o \\\n  \\  ≡  /\n   \\___/",
  },
  {
    message: "More human time for decisions, less for typing",
    character: "   _____\n  /     \\\n  | () () |\n  |   >  |\n  |  \\__/\n   \\___/",
  },
  {
    message: "Let's keep things moving forward!",
    character: "   \\___/\n  /o o\\\n  (  = )\n  /|   |\\\n   | | |\n  (   )",
  },
];

/**
 * Selects the next message in rotation based on deterministic logic.
 * Uses second-level granularity for time-based selection.
 * Pure function with no side effects.
 *
 * @returns The character and message to display
 */
export function selectStartupMessage(): StartupMessage {
  // Use second-level granularity for deterministic rotation
  // This provides variety during testing while remaining deterministic
  const now = new Date();
  const secondsSinceMidnight =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const index = secondsSinceMidnight % MESSAGES.length;
  return MESSAGES[index];
}

/**
 * Formats the message as cowsay-style ASCII art and returns as a string.
 * Pure function.
 *
 * @param msg - The message and character to format
 * @returns Formatted output ready to pass to console.log()
 */
export function formatStartupMessage(msg: StartupMessage): string {
  const maxLineWidth = 70;

  // Wrap the message to fit within balloon
  const wrappedLines = wrapText(msg.message, maxLineWidth);

  // Create balloon
  const balloonLines: string[] = [];
  balloonLines.push(" " + "_".repeat(maxLineWidth + 2));

  for (let i = 0; i < wrappedLines.length; i++) {
    const line = wrappedLines[i];
    const paddedLine = line.padEnd(maxLineWidth);
    if (i === 0 && wrappedLines.length === 1) {
      balloonLines.push(`/ ${paddedLine} \\`);
    } else if (i === 0) {
      balloonLines.push(`/ ${paddedLine} \\`);
    } else if (i === wrappedLines.length - 1) {
      balloonLines.push(`\\ ${paddedLine} /`);
    } else {
      balloonLines.push(`| ${paddedLine} |`);
    }
  }

  balloonLines.push(" " + "_".repeat(maxLineWidth + 2));

  // Add tail connector
  balloonLines.push("        \\");
  balloonLines.push("         \\");

  // Add character
  const characterLines = msg.character.split("\n");
  for (const line of characterLines) {
    balloonLines.push(line);
  }

  return balloonLines.join("\n");
}

/**
 * Wraps text to fit within a maximum line width.
 * Pure function.
 *
 * @param text - The text to wrap
 * @param maxWidth - Maximum width per line
 * @returns Array of wrapped lines
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + word).length <= maxWidth) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}
