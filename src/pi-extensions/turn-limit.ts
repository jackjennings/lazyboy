import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const rawMaxTurns = process.env.PI_MAX_TURNS;

export default function (pi: ExtensionAPI) {
  if (rawMaxTurns === undefined) return;
  const maxTurns = Number(rawMaxTurns);
  pi.on("turn_start", (event, ctx) => {
    if (event.turnIndex >= maxTurns) {
      console.error(`turn limit reached (${event.turnIndex}/${maxTurns})`);
      ctx.abort();
    }
  });
}
