/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three/drei ship untranspiled ESM that Next's server compiler needs to handle.
  transpilePackages: ["three"],
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Keeps the Three.js chunk out of the shared bundle so the marketing
    // hero can code-split it away from every other route.
    optimizePackageImports: ["lucide-react", "@react-three/drei"],
  },
};

export default nextConfig;
