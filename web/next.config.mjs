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
          // "credentialless" still enables cross-origin isolation (needed for
          // SharedArrayBuffer / DuckDB-WASM) but lets the browser fetch
          // cross-origin resources (e.g. OSM tile servers) that don't set a
          // Cross-Origin-Resource-Policy header — which "require-corp" blocks.
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
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
