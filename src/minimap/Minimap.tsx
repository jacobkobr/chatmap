import { useState } from "react";
import type { ThreadMapSettings } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { useMessageIndex } from "./useMessageIndex";
import { Marker } from "./Marker";
import { isMarkerVisible } from "./markerClassifier";
import { clamp } from "../shared/utils";

interface Props {
  adapter: ChatSiteAdapter;
  settings: ThreadMapSettings;
}

export function Minimap({ adapter, settings }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { messages, scrollHeight } = useMessageIndex(adapter);

  const visible = messages.filter((m) => isMarkerVisible(m, settings));

  return (
    <div
      className={`rail${expanded ? " rail--expanded" : ""}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      aria-label="conversation minimap"
      role="navigation"
    >
      {visible.map((msg) => {
        const topPercent = clamp((msg.top / scrollHeight) * 100, 0, 99);

        return (
          <Marker
            key={msg.id}
            msg={msg}
            index={messages.indexOf(msg)}
            total={messages.length}
            topPercent={topPercent}
            settings={settings}
          />
        );
      })}

      {visible.length === 0 && expanded && (
        <div className="rail-empty">no messages yet</div>
      )}
    </div>
  );
}
