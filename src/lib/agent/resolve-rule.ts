/** Resolve the active send policy, with AI-config thresholds as hard floors.
 * Configuration read errors propagate: never silently send using lower env values.
 */
import { getActiveAiConfig } from "@/lib/ai/config-service";
import { applyActiveSendFloors, loadAutoSendRule, policyToRule, type AutoSendRule } from "./rules";

export { policyToRule };

export async function resolveAutoSendRule(): Promise<AutoSendRule> {
  const config = await getActiveAiConfig();
  const base = config.autoSendPolicy?.useCustom ? policyToRule(config.autoSendPolicy) : loadAutoSendRule();
  return applyActiveSendFloors(base, config);
}
