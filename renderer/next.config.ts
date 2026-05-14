import { NextConfig } from 'next'

const isProd = process.env.NODE_ENV === 'production'

const config: NextConfig = {
  output: 'export',
  distDir: isProd ? '../app' : '.next',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['libsql', '@libsql/client'],
  devIndicators: false,
}

export default config
