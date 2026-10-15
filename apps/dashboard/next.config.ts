import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Workspace packages are TypeScript source.
  transpilePackages: ["@medguides/schema", "@medguides/ui-tokens"],
};

export default nextConfig;
