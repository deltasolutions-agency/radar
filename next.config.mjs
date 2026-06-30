/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build standalone per immagine Docker minimale (output in .next/standalone).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // I client Prisma/Stripe/Resend restano lato server.
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;
