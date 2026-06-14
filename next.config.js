/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const repoBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (isProd ? '/Interviewer' : '');

const nextConfig = {
  output: 'export',
  basePath: repoBasePath,
  assetPrefix: repoBasePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};

module.exports = nextConfig;
