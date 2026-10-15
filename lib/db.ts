import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let prismaClientInstance: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }
  
  if (prismaClientInstance) {
    return prismaClientInstance;
  }

  // Next.js might stringify undefined vars to literal "undefined" in some edge cases.
  let url = process.env.DATABASE_URL;
  if (url === 'undefined' || url === 'null') {
    url = undefined;
  }

  if (!url) {
    try {
      require('dotenv').config({ path: '.env' });
      url = process.env.DATABASE_URL;
      if (url === 'undefined' || url === 'null') url = undefined;
    } catch {
      // ignore
    }
  }

  if (!url) {
    throw new Error('DATABASE_URL is strictly undefined or missing. Check your .env.');
  }

  // In Prisma 7, PrismaNeon expects a PoolConfig object, NOT a Pool instance.
  // We pass the connection string, and PrismaNeon will internally create a neon.Pool 
  // using this config along with the globally defined ws constructor.
  const hostname = new URL(url).hostname;
  const adapter = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    ? new PrismaPg({ connectionString: url })
    : new PrismaNeon({ connectionString: url });
  const client = new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }
  
  prismaClientInstance = client;

  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return getClient()[prop as keyof PrismaClient];
  },
});

