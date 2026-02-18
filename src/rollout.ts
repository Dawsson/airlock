/**
 * Deterministic hash-based rollout check.
 * Same device + update always produces the same result.
 */
export async function isInRollout(
  deviceId: string,
  updateId: string,
  percentage: number
): Promise<boolean> {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;

  const data = new TextEncoder().encode(deviceId + updateId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const view = new DataView(hashBuffer);
  const value = view.getUint32(hashBuffer.byteLength - 4) % 100;
  return value < percentage;
}
