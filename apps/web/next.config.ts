import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // NOTE: do NOT put GATEWAY_URL / tenant here — `env` inlines values at BUILD
  // time. The proxy route reads them from process.env at RUNTIME instead so the
  // compose-provided container env wins.
};

export default nextConfig;
