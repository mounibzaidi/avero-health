import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Workspace packages are TypeScript source.
  transpilePackages: ["@avero/schema", "@avero/ui-tokens"],
};

export default nextConfig;
