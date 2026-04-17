/** @type {import('next').NextConfig} */
const nextConfig = {
  // duckdb-wasm needs cross-origin isolation for SharedArrayBuffer.
  // These headers enable it during local dev.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Allow loading WASM and worker files
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
