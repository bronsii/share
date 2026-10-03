import "server-only";

import geoip from "geoip-lite";
import { isIP } from "node:net";
import { transientClientAddress } from "@/lib/request-security";
import { ACCESS_LOCATION_KEY_PATTERN, type AccessLocationKey } from "@/lib/access-location-key";

/**
 * A deliberately coarse location key. Only ISO country and (when available)
 * a short subdivision code are persisted; IP addresses and city data never
 * leave this request.
 */

export function lookupAccessLocation(request: Request): AccessLocationKey | null {
  let address: string;
  try {
    address = transientClientAddress(request);
  } catch {
    // A missing or invalid GeoIP result must never make a valid download fail.
    return null;
  }
  if (!isIP(address)) return null;

  let result: { country?: unknown; region?: unknown } | null;
  try {
    result = geoip.lookup(address) as { country?: unknown; region?: unknown } | null;
  } catch {
    return null;
  }
  if (!result || typeof result.country !== "string") return null;
  const country = result.country.toUpperCase();
  if (!/^[A-Z]{2}$/u.test(country)) return null;

  const region = typeof result.region === "string" ? result.region.toUpperCase() : "";
  const key = /^[A-Z0-9]{1,3}$/u.test(region) ? `${country}-${region}` : country;
  return ACCESS_LOCATION_KEY_PATTERN.test(key) ? key : country;
}
