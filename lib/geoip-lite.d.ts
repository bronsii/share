declare module "geoip-lite" {
  type GeoIpResult = {
    country?: string;
    region?: string;
  };

  const geoip: {
    lookup(ip: string): GeoIpResult | null;
  };

  export default geoip;
}
