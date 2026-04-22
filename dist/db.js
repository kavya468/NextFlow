"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const serverless_1 = require("@neondatabase/serverless");
const adapter_neon_1 = require("@prisma/adapter-neon");
const client_1 = require("@prisma/client");
const ws_1 = __importDefault(require("ws"));
serverless_1.neonConfig.webSocketConstructor = ws_1.default;
const globalForPrisma = globalThis;
let prismaClientInstance;
function getClient() {
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
            if (url === 'undefined' || url === 'null')
                url = undefined;
        }
        catch {
            // ignore
        }
    }
    if (!url) {
        throw new Error('DATABASE_URL is strictly undefined or missing. Check your .env.');
    }
    console.log('[db.ts] Initializing Neon config with URL length:', url.length);
    // In Prisma 7, PrismaNeon expects a PoolConfig object, NOT a Pool instance.
    // We pass the connection string, and PrismaNeon will internally create a neon.Pool 
    // using this config along with the globally defined ws constructor.
    const adapter = new adapter_neon_1.PrismaNeon({ connectionString: url });
    const client = new client_1.PrismaClient({ adapter });
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = client;
    }
    prismaClientInstance = client;
    return client;
}
exports.prisma = new Proxy({}, {
    get(_target, prop) {
        return getClient()[prop];
    },
});
