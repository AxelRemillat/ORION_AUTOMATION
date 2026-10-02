/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Stats et Coûts sont devenus des sections de Réglages (lot 3, 03/10/2026).
  async redirects() {
    return [
      { source: "/stats", destination: "/reglages/donnees", permanent: true },
      { source: "/couts", destination: "/reglages/couts", permanent: true },
    ];
  },
};

export default nextConfig;
