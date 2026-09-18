"use client";

import { useState } from "react";
import { AutoSendCard } from "./auto-send-card";
import { BaleOutbox } from "./bale-outbox";
import { BaleTestCard } from "./bale-test-card";
import { NewsFetchCard } from "./news-fetch-card";

/**
 * Coordinates dashboard action cards so any automatic or manual send action
 * immediately updates the Local Outbox.
 */
export function DashboardActions() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <>
      <NewsFetchCard onIngestComplete={bump} />
      <AutoSendCard onAutoSendComplete={bump} />
      <BaleTestCard onTestComplete={bump} />
      <BaleOutbox refreshKey={refreshKey} />
    </>
  );
}
