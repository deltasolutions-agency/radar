/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Nessun uso di next/image: l'optimizer (/_next/image) è disattivato per
  // ridurre la superficie d'attacco (advisory Next.js sull'Image Optimization
  // API). Loghi e immagini sono <img> statici da /public, serviti direttamente.
  images: { unoptimized: true },
  experimental: {
    // I client Prisma/Stripe/Resend restano lato server.
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;
