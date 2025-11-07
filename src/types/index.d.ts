// // src/types/index.d.ts
// // FINAL FIX FOR express.json() and express.urlencoded() + ALL OTHER ERRORS — ZERO RED LINES

// import express from 'express';
// import type { RequestHandler } from 'express';

// // Augment express with json and urlencoded
// declare module 'express' {
//   interface Express {
//     json: typeof express.json;
//     urlencoded: typeof express.urlencoded;
//   }
//   export = express;
// }

// // Mongoose
// declare module 'mongoose' {
//   export = mongoose;
// }

// // Cors
// declare module 'cors' {
//   import cors from 'cors';
//   export default cors;
// }

// // CookieParser
// declare module 'cookie-parser' {
//   import cookieParser from 'cookie-parser';
//   export default cookieParser;
// }

// // Multer
// declare module 'multer' {
//   export = multer;
// }

// // Other CommonJS defaults
// declare module 'bcrypt' { const bcrypt: any; export default bcrypt; }
// declare module 'jsonwebtoken' { const jwt: any; export default jwt; }
// declare module 'nodemailer' { const nodemailer: any; export default nodemailer; }

// export {};