import React from "react";
import { getTheme } from "../../../utils/theme-engine.js";
import { MarqueeText } from "../../../components/MarqueeText.component.jsx";
import { Pane } from "./Pane.component.jsx";
import { effortLabel } from "../../../utils/worker-effort.js";

const colors = getTheme().colors;

export function TierPane({
  tier,
  tierWorkers,
  defaultOpenAIModel,
  tierScroll,
  activeControl,
}) {
  const pane = (index, title, children, footer) => (
    <Pane index={index} title={title} footer={footer} activeControl={activeControl}>
      {children}
    </Pane>
  );
  return pane(
  1,
  "02 TIERS",
  <scrollbox
    ref={tierScroll}
    flexGrow={1}
    minHeight={0}
    scrollY
    scrollX={false}
    contentOptions={{ flexDirection: "column" }}
  >
    {[1, 2, 3].map((number) => {
      const selected = activeControl === 1 && tier === number;
      const configured = Boolean(tierWorkers[number]?.model || defaultOpenAIModel);
      return (
        <box
          key={number}
          id={`tier-${number}`}
          flexDirection="column"
          flexShrink={0}
          backgroundColor={selected ? colors.selected : undefined}
          paddingX={1}
        >
          <MarqueeText
            fg={configured ? colors.green : selected ? colors.selectedText : colors.text}
            bold={selected || configured}
            active={selected}
          >
            {`${selected ? "› " : "· "}Tier ${number} · ${tierWorkers[number]?.model || defaultOpenAIModel || "Not configured"} · ${effortLabel(tierWorkers[number])}`}
          </MarqueeText>
        </box>
      );
    })}
  </scrollbox>,
  "↑↓ select · Enter assign",
  );
}
