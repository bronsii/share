declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    SHARE_FILES: R2Bucket;
  }
}
