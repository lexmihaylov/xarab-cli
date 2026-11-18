import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import { getTheme } from "../utils/theme-engine.js";

const colors = getTheme().welcome;

// The composer uses four rows at its minimum size and the status bar uses one.
const appChromeRows = 5;
// Rasterized at 8px from the landing page's Press Start 2P Regular font:
// https://github.com/google/fonts/tree/main/ofl/pressstart2p (SIL OFL 1.1).
// Each glyph occupies an 8×8 cell; half blocks preserve square pixel proportions.
const glyphs = {
  x: [
    "........",
    "........",
    "##...##.",
    ".##.##..",
    "..###...",
    ".##.##..",
    "##...##.",
    "........",
  ],
  a: [
    "........",
    "........",
    ".#####..",
    ".....##.",
    ".######.",
    "##...##.",
    ".######.",
    "........",
  ],
  r: [
    "........",
    "........",
    ".##.###.",
    ".###....",
    ".##.....",
    ".##.....",
    ".##.....",
    "........",
  ],
  b: [
    "##......",
    "##......",
    "######..",
    "##...##.",
    "##...##.",
    "##...##.",
    ".#####..",
    "........",
  ],
};
const pixels = Array.from({ length: 8 }, (_, row) =>
  [..."xarab"].map((letter) => glyphs[letter][row]).join(""),
);
const blocks = [" ", "▄", "▀", "█"];
const wordmark = Array.from({ length: 4 }, (_, row) =>
  Array.from(
    { length: 40 },
    (_, x) =>
      blocks[(pixels[row * 2][x] === "#" ? 2 : 0) + (pixels[row * 2 + 1][x] === "#" ? 1 : 0)],
  ).join(""),
);

export function Welcome() {
  const { width, height } = useTerminalDimensions();
  const availableRows = Math.max(0, height - appChromeRows);
  const showWordmark = width >= 40 && availableRows >= 14;
  const commands = [
    ["/connect", "Connect a provider"],
    ["/route", "Set up routing and workers"],
    ["/download", "Find local models"],
    ["/sessions", "Browse saved sessions"],
    ["/clear", "Clear the conversation"],
    ["/new", "Start a new session"],
    ["!command", "Run a shell command"],
  ];
  const logoRows = showWordmark ? 4 : 1;
  const margin = availableRows >= 10 ? 1 : 0;
  const visibleCommands = Math.max(0, availableRows - logoRows - margin - 1);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      minHeight="100%"
      alignItems="center"
      justifyContent="center"
      width="100%"
    >
      {showWordmark ? (
        <box flexDirection="column" alignItems="center">
          {wordmark.map((row, index) => (
            <text key={index} fg={colors.brand}>
              {row}
            </text>
          ))}
        </box>
      ) : (
        <text fg={colors.brand} bold>
          XARAB
        </text>
      )}
      <box flexDirection="column" marginTop={margin}>
        {commands.slice(0, visibleCommands).map(([command, description]) => {
          const showDescription = `${command.padEnd(10)} ${description}`.length <= width;
          return (
            <box key={command} flexDirection="row">
              <text fg={colors.heading}>{showDescription ? command.padEnd(10) : command}</text>
              {showDescription ? <text fg={colors.copy}> {description}</text> : null}
            </box>
          );
        })}
      </box>
    </box>
  );
}
