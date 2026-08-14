import "server-only";

export type ImprintDetails = {
  name: string;
  street: string;
  locality: string;
  country: string;
  email: string;
};

function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getImprintDetails(): ImprintDetails {
  const details = {
    name: requiredEnvironmentValue("SHARE_IMPRINT_NAME"),
    street: requiredEnvironmentValue("SHARE_IMPRINT_STREET"),
    locality: requiredEnvironmentValue("SHARE_IMPRINT_LOCALITY"),
    country: requiredEnvironmentValue("SHARE_IMPRINT_COUNTRY"),
    email: requiredEnvironmentValue("SHARE_IMPRINT_EMAIL"),
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) {
    throw new Error("SHARE_IMPRINT_EMAIL must be a valid email address.");
  }

  return details;
}
