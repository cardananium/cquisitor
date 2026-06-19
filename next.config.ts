import type { NextConfig } from "next";

const isGithubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  // Static export for GitHub Pages
  output: "export",
  
  // Set base path for GitHub Pages (repository name)
  basePath: isGithubPages ? "/cquisitor" : "",
  assetPrefix: isGithubPages ? "/cquisitor/" : "",
  
  // Disable image optimization (not supported in static export)
  images: {
    unoptimized: true,
  },
  
  // Pin the workspace root so Turbopack doesn't misinfer it (it sometimes guesses
  // src/app, which then breaks @/ imports that live outside it).
  turbopack: {
    root: process.cwd(),
  },
  
  webpack: (config, { isServer }) => {
    // Enable WebAssembly
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Fix for WASM modules in Next.js
    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });

    // Handle WASM file resolution for server-side
    if (isServer) {
      config.output.webassemblyModuleFilename = "./../static/wasm/[modulehash].wasm";
    } else {
      config.output.webassemblyModuleFilename = "static/wasm/[modulehash].wasm";
    }

    return config;
  },
};

export default nextConfig;
