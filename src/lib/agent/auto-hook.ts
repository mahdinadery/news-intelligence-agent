import { runAutoDeliveryPass } from "./index";

/**
 * Shared, failure-proof hook so the auto-delivery pass can run after an event
 * (news fetched, or an article analyzed) without ever breaking that flow.
 *
 * The delivery pass is fire-and-report: it returns a compact summary for the UI,
 * and any error is swallowed into `attempted: false` rather than thrown, so an
 * unreachable provider can never fail the analysis/ingestion response.
 */

export type AutoSendSummary = {
  attempted: boolean;
  enabled: boolean;
  destination: string;
  considered: number;
  matched: number;
  sent: number;
  skippedDuplicates: number;
  failed: number;
};

function disabled(destination = "", enabled = true): AutoSendSummary {
  return {
    attempted: false,
    enabled,
    destination,
    considered: 0,
    matched: 0,
    sent: 0,
    skippedDuplicates: 0,
    failed: 0,
  };
}

export async function maybeRunAutoSend(newsIds?: string[]): Promise<AutoSendSummary> {
  try {
    const result = await runAutoDeliveryPass({ newsIds });

    return {
      attempted: true,
      enabled: result.enabled,
      destination: result.destination,
      considered: result.considered,
      matched: result.matched,
      sent: result.sent,
      skippedDuplicates: result.skippedDuplicates,
      failed: result.failed,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[agent] auto-send pass failed:", detail.slice(0, 160));
    return disabled();
  }
}
