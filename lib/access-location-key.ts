/** ISO country plus an optional short subdivision code, e.g. DE-BY or US-NY. */
export const ACCESS_LOCATION_KEY_PATTERN = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/u;

export type AccessLocationKey = string;
