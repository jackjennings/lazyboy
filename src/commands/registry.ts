import { tick } from "./tick.ts";
import { approve } from "./approve.ts";
import { status } from "./status.ts";
import { enable } from "./enable.ts";
import { disable } from "./disable.ts";
import { ids } from "./ids.ts";
import { completion } from "./completion.ts";
import { completions } from "./completions.ts";
import { retry } from "./retry.ts";
import { decline } from "./decline.ts";
import { review } from "./review.ts";
import { shell } from "./shell.ts";
import { tail } from "./tail.ts";
import { update } from "./update.ts";
import { hud } from "./hud.ts";
import type { Command } from "./types.ts";

export const commands: Command[] = [
  tick,
  approve,
  status,
  enable,
  disable,
  ids,
  completion,
  completions,
  retry,
  decline,
  review,
  shell,
  tail,
  update,
  hud,
];
