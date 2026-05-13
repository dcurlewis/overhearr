/* eslint-disable @typescript-eslint/no-unused-vars */
import type { NextFunction, Request, Response } from 'express';
import 'express-session';

import type { PublicUser } from './domain';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  namespace Express {
    export interface Request {
      user?: PublicUser;
      locale?: string;
    }
  }

  export type Middleware = <ParamsDictionary, any, any>(
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void | NextFunction> | void | NextFunction;
}
